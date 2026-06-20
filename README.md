firebase.cmd emulators:start --only hosting --project carelearnpro

# CareLearn Pro Firebase Rebuild

This version replaces Apps Script web-app login with Firebase Hosting + Firebase Authentication Google Sign-In.

## What is included

- Firebase Hosting static web app.
- Firebase Authentication with Google provider.
- Cloud Firestore database.
- Google Drive links for course files.
- E-signature pad with crop.
- Course builder with optional MCQ.
- Courses table grouped by department.
- Completion tracking and attendance records.
- CSV export.
- Optional Apps Script bridge to generate Google Docs/PDF attendance sheets.

## Folder structure

```text
CareLearn_Firebase_Rebuild/
  firebase.json
  firestore.rules
  .firebaserc.example
  public/
    index.html
    styles.css
    app.js
    firebase-config.example.js
    firebase-config.js        # local only, ignored by git
  apps-script/
    Code.gs
```

## Firebase setup

1. Create a Firebase project.
2. Open Authentication > Sign-in method > enable Google.
3. Open Firestore Database > create database.
4. Open Project settings > Web app > copy Firebase config.
5. Copy `public/firebase-config.example.js` to `public/firebase-config.js`.
6. Paste your Firebase config into `public/firebase-config.js`.
   This file is ignored by git and should not be committed.
7. Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules
```

8. Deploy hosting:

```bash
firebase deploy --only hosting
```

## First admin

After the first login, open Firestore > users > your UID and set:

```json
{
  "role": "SuperAdmin",
  "departments": ["Director General Office"],
  "primaryDepartment": "Director General Office"
}
```

Then reload the web app.

## Course Manager role

To give a department head course ownership, set the user's Firestore profile role to:

```json
{
  "role": "CourseManager",
  "departments": ["Department Name"],
  "primaryDepartment": "Department Name"
}
```

Course Managers can create courses for their departments, manage members for their own course groups, approve join requests, and see coverage percentage plus pending members on the dashboard.

## Free usage approach

Recommended free/low-cost setup:

- Firebase Hosting for static files.
- Firebase Authentication Google sign-in.
- Cloud Firestore for users, courses, attendance.
- Google Drive links for training materials.
- Apps Script only for Google Docs/PDF attendance export.

Avoid Cloud Functions if you want to stay on free-only usage because server backend functions generally require billing setup.

## Apps Script export bridge

1. Create a new Apps Script project.
2. Paste `apps-script/Code.gs`.
3. Open Project Settings > Script Properties and add:

```text
FIREBASE_WEB_API_KEY = your Firebase Web API key
ATTENDANCE_DOC_TEMPLATE_ID = optional Google Docs template ID
```

If `ATTENDANCE_DOC_TEMPLATE_ID` is not set, the bridge uses the bundled attendance template:

```text
1zsSPyTBmU1VDMXkUbVkTyDvO2mGigj2aOReO49J5xAY
```

4. Deploy as Web App:
   - Execute as: Me
   - Who has access: Anyone
5. Copy the Web App URL.
6. Paste it inside CareLearn Pro > Admin > Export Settings.

### Google Docs template placeholders

Header placeholders:

```text
<<COURSE_NAME>>
<<DEPARTMENT>>
<<DATE>>
<<VENUE>>
<<CYCLE>>
<<EXPORT_DATE>>
<<TOTAL_COMPLETED>>
```

Table template row placeholders:

```text
<<SN>> | <<NAME>> | <<DATE>> | <<JOB_ID>> | <<Position>> | <<SIGNATURE>>
```

The Apps Script export bridge will remove the template row and fill all attendance records automatically.

## GitHub-safe setup

Before pushing to GitHub, make sure these files are not committed:

```text
public/firebase-config.js
.firebaserc
firebase-debug.log
Old index + styles/
.agents/
```

The repository includes safe examples instead:

```text
public/firebase-config.example.js
.firebaserc.example
```

Recommended commands:

```bash
git init
git add .
git status
git commit -m "Initial secure CareLearn Pro rebuild"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

If any secret was previously committed, rotate it in Firebase/Google and remove it from git history before making the repository public.

## Security notes

- Users do not create passwords; Google handles sign-in.
- Firestore rules restrict admin and manager actions.
- Drive content should be shared with the intended audience or set to restricted links for hospital users.
- Restrict the Firebase Web API key in Google Cloud Console by HTTP referrers after deployment.
- Keep Apps Script Script Properties out of source control.
- For stronger exam integrity, you would need a trusted backend, but this version is designed for light internal training and free usage.
