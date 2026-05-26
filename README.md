# Student Feedback System

This project is a web-based student feedback system with two user roles: admin and student.

## Features
- Admin registration with role, Gmail, password, and faculty ID card photo upload
- Subject entry after registration for faculty, HOD, and lab faculty
- Principal may skip subject selection
- Admin login with email and password
- Student login with roll number, department, and attendance validation
- Feedback submission with subject, faculty, and comments
- Admin feedback view by department with sentiment categories and charts
- Password recovery with OTP email support

## Setup
1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and configure SMTP for OTP delivery if desired.

3. Run the app:

```bash
npm start
```

4. Open the browser at `http://localhost:3000`
