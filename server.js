require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedbacks.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}
if (!fs.existsSync(FEEDBACK_FILE)) {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify({ feedbacks: [] }, null, 2));
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function analyzeSentiment(text) {
  const normalized = text.toLowerCase();
  const positiveWords = ['good', 'great', 'excellent', 'positive', 'helpful', 'best', 'clear', 'nice'];
  const negativeWords = ['bad', 'poor', 'worse', 'problem', 'difficult', 'confusing', 'hate', 'slow'];
  let score = 0;
  positiveWords.forEach(word => { if (normalized.includes(word)) score += 1; });
  negativeWords.forEach(word => { if (normalized.includes(word)) score -= 1; });

  if (score > 0) return 'Positive';
  if (score < 0) return 'Negative';
  return 'Neutral';
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'feedback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
    cb(null, unique);
  }
});
const upload = multer({ storage });

const otpStore = {};

function ensureAdmin(req, res, next) {
  if (!req.session.adminEmail) {
    return res.redirect('/admin/login');
  }
  next();
}

function ensureStudent(req, res, next) {
  if (!req.session.studentRoll) {
    return res.redirect('/student/login');
  }
  next();
}

app.get('/', (req, res) => {
  res.render('index', { user: req.session.adminEmail || req.session.studentRoll });
});

app.get('/admin/register', (req, res) => {
  res.render('admin-register', { error: null });
});

app.post('/admin/register', upload.single('facultyPhoto'), (req, res) => {
  const { name, email, password, role, department } = req.body;
  const data = loadJson(USERS_FILE);
  const exists = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (!name || !email || !password || !role || !department) {
    return res.render('admin-register', { error: 'Please fill all required fields.' });
  }
  if (exists) {
    return res.render('admin-register', { error: 'An admin with this email already exists.' });
  }
  if (!req.file) {
    return res.render('admin-register', { error: 'Please upload your faculty ID card photo.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password,
    role,
    department,
    subjects: [],
    facultyPhoto: `/uploads/${req.file.filename}`,
    registrationComplete: false,
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  saveJson(USERS_FILE, data);
  
  req.session.pendingRegEmail = email;
  res.redirect('/admin/register-subjects');
});

app.get('/admin/register-subjects', (req, res) => {
  if (!req.session.pendingRegEmail) {
    return res.redirect('/admin/register');
  }
  const data = loadJson(USERS_FILE);
  const user = data.users.find(u => u.email.toLowerCase() === req.session.pendingRegEmail.toLowerCase());
  if (!user) {
    return res.redirect('/admin/register');
  }
  res.render('admin-register-subjects', { role: user.role, error: null });
});

app.post('/admin/register-subjects', (req, res) => {
  if (!req.session.pendingRegEmail) {
    return res.redirect('/admin/register');
  }
  const { subjects, skip } = req.body;
  const data = loadJson(USERS_FILE);
  const userIndex = data.users.findIndex(u => u.email.toLowerCase() === req.session.pendingRegEmail.toLowerCase());
  if (userIndex === -1) {
    return res.redirect('/admin/register');
  }
  const user = data.users[userIndex];
  
  let subjectList = [];
  if (subjects) {
    subjectList = Array.isArray(subjects) ? subjects.filter(Boolean) : [subjects].filter(Boolean);
  }

  const isPrincipal = user.role.toLowerCase() === 'principal';
  const skipped = skip === 'true' || skip === 'skip' || req.body.hasOwnProperty('skipBtn');

  if (isPrincipal && (skipped || subjectList.length === 0)) {
    user.subjects = [];
    user.registrationComplete = true;
  } else {
    if (subjectList.length === 0) {
      return res.render('admin-register-subjects', { 
        role: user.role, 
        error: 'Please enter at least one subject.' 
      });
    }
    user.subjects = subjectList;
    user.registrationComplete = true;
  }

  data.users[userIndex] = user;
  saveJson(USERS_FILE, data);
  delete req.session.pendingRegEmail;
  res.redirect('/admin/login');
});

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  const data = loadJson(USERS_FILE);
  const user = data.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase() && u.password === password);
  if (!user) {
    return res.render('admin-login', { error: 'Invalid email or password.' });
  }
  if (user.registrationComplete === false) {
    req.session.pendingRegEmail = user.email;
    return res.redirect('/admin/register-subjects');
  }
  req.session.adminEmail = user.email;
  req.session.adminId = user.id;
  res.redirect('/admin/dashboard');
});

app.get('/student/login', (req, res) => {
  res.render('student-login', { error: null });
});

app.post('/student/login', (req, res) => {
  const { roll, department, attendance } = req.body;
  const attendanceNumber = Number(attendance);
  if (!roll || !department || Number.isNaN(attendanceNumber)) {
    return res.render('student-login', { error: 'Please fill all fields correctly.' });
  }
  if (attendanceNumber < 75) {
    return res.render('student-login', { error: 'Access Denied: Invalid credentials or eligibility requirements not met.' });
  }
  req.session.studentRoll = roll;
  req.session.studentDepartment = department;
  req.session.studentAttendance = attendanceNumber;
  req.session.feedbackSubmitted = false;
  res.redirect('/student/dashboard');
});

app.get('/admin/dashboard', ensureAdmin, (req, res) => {
  const data = loadJson(USERS_FILE);
  const feedbackData = loadJson(FEEDBACK_FILE);
  const user = data.users.find(u => u.email === req.session.adminEmail);
  const department = req.query.department || 'all';
  const allDepartments = ['CSE', 'ECE', 'EEE', 'ME', 'CE', 'IT'];
  const filtered = department === 'all' ? feedbackData.feedbacks : feedbackData.feedbacks.filter(f => f.department === department);

  const years = {};
  const currentYear = new Date().getFullYear();
  years[currentYear] = { Positive: 0, Negative: 0, Neutral: 0 };

  const months = Array.from({ length: 12 }, (_, i) => ({ 
    label: new Date(currentYear, i).toLocaleString('default', { month: 'short' }), 
    positive: 0, 
    negative: 0, 
    neutral: 0 
  }));
  const sentimentTotals = { Positive: 0, Negative: 0, Neutral: 0 };

  filtered.forEach(feedback => {
    sentimentTotals[feedback.sentiment] = (sentimentTotals[feedback.sentiment] || 0) + 1;
    const year = new Date(feedback.submittedAt).getFullYear();
    if (!years[year]) {
      years[year] = { Positive: 0, Negative: 0, Neutral: 0 };
    }
    years[year][feedback.sentiment] = (years[year][feedback.sentiment] || 0) + 1;
    if (year === currentYear) {
      const monthIndex = new Date(feedback.submittedAt).getMonth();
      months[monthIndex][feedback.sentiment.toLowerCase()] += 1;
    }
  });

  res.render('admin-dashboard', {
    user,
    feedbacks: filtered,
    departments: allDepartments,
    selectedDepartment: department,
    sentimentTotals,
    years,
    monthlyData: months
  });
});

app.post('/admin/edit-subjects', ensureAdmin, (req, res) => {
  const { subjects = [] } = req.body;
  const userData = loadJson(USERS_FILE);
  const userIndex = userData.users.findIndex(u => u.email === req.session.adminEmail);
  if (userIndex === -1) {
    return res.redirect('/admin/login');
  }
  const updatedSubjects = Array.isArray(subjects) ? subjects.filter(Boolean) : [subjects].filter(Boolean);
  userData.users[userIndex].subjects = updatedSubjects;
  saveJson(USERS_FILE, userData);
  res.redirect('/admin/dashboard');
});

app.get('/admin/recover', (req, res) => {
  res.render('admin-recover', { message: null, error: null, otp: null, email: '' });
});

app.post('/admin/recover', async (req, res) => {
  const { email } = req.body;
  const userData = loadJson(USERS_FILE);
  const user = userData.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user) {
    return res.render('admin-recover', { message: null, error: 'No admin account found with that email.', otp: null, email: '' });
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  otpStore[email.toLowerCase()] = otp;
  let text = `Your password reset OTP is ${otp}`;
  let message = `An OTP has been generated.`;
  let otpReceived = null;
  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject: 'Student Feedback System OTP',
        text
      });
      message = `An OTP has been sent to your registered email.`;
    } else {
      otpReceived = otp;
      message = `SMTP is not configured. Your OTP code is generated below for local testing:`;
    }
  } catch (error) {
    otpReceived = otp;
    message = `Email delivery failed. Your OTP code is generated below for local testing:`;
  }
  res.render('admin-recover', { message, error: null, otp: otpReceived, email });
});

app.get('/admin/reset', (req, res) => {
  res.render('admin-reset', { error: null, info: null, email: req.query.email || '' });
});

app.post('/admin/reset', (req, res) => {
  const { email, otp, password, confirmPassword } = req.body;
  const userData = loadJson(USERS_FILE);
  const userIndex = userData.users.findIndex(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (userIndex === -1) {
    return res.render('admin-reset', { error: 'Email not found.', info: null, email });
  }
  const validOtp = otpStore[email.toLowerCase()];
  if (otp !== validOtp) {
    return res.render('admin-reset', { error: 'Invalid OTP.', info: null, email });
  }
  if (!password || password !== confirmPassword) {
    return res.render('admin-reset', { error: 'Passwords must match.', info: null, email });
  }
  userData.users[userIndex].password = password;
  saveJson(USERS_FILE, userData);
  delete otpStore[email.toLowerCase()];
  res.render('admin-reset', { error: null, info: 'Password updated successfully. Please log in.', email: '' });
});

app.get('/student/dashboard', ensureStudent, (req, res) => {
  const showAttendance = req.session.feedbackSubmitted || false;
  res.render('student-dashboard', {
    roll: req.session.studentRoll,
    department: req.session.studentDepartment,
    attendance: req.session.studentAttendance,
    showAttendance: showAttendance,
    message: req.session.feedbackMessage || null,
    error: null
  });
  req.session.feedbackMessage = null;
});

app.post('/student/submit-feedback', ensureStudent, (req, res) => {
  const { subject, faculty, feedback } = req.body;
  if (!subject || !faculty || !feedback) {
    return res.render('student-dashboard', {
      roll: req.session.studentRoll,
      department: req.session.studentDepartment,
      attendance: req.session.studentAttendance,
      showAttendance: false,
      message: null,
      error: 'Please fill all feedback fields.'
    });
  }
  const feedbackData = loadJson(FEEDBACK_FILE);
  const sentiment = analyzeSentiment(feedback);
  feedbackData.feedbacks.push({
    id: crypto.randomUUID(),
    roll: req.session.studentRoll,
    department: req.session.studentDepartment,
    attendance: req.session.studentAttendance,
    subject,
    faculty,
    feedback,
    sentiment,
    submittedAt: new Date().toISOString()
  });
  saveJson(FEEDBACK_FILE, feedbackData);
  
  req.session.feedbackSubmitted = true;
  req.session.feedbackMessage = 'Thank you! Your feedback has been submitted successfully.';
  res.redirect('/student/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Student Feedback System is running at http://localhost:${PORT}`);
});
