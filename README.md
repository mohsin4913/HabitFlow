# HabitFlow

**Live application:** https://mohsin4913.github.io/HabitFlow/  
**Source repository:** https://github.com/mohsin4913/HabitFlow

HabitFlow is a deployed, browser-based habit tracker for daily check-ins, streak history, weekly progress, and printable activity reports. Accounts and data are stored locally in the browser; no cloud backend or server-side authentication is used.

## Features

- Daily habit creation, editing, completion, deletion, schedules, and optional reminder times
- Per-account current and longest streak tracking with long-term completion and skip history
- Weekly progress chart, statistics, perfect-day tracking, and per-habit performance
- Reports & Downloads section with printable PDF reports and JSON data export
- Installable PWA with a service-worker app shell and IndexedDB synchronization
- Browser notifications with Done, Snooze, and Skip actions while the app scheduler is active
- Responsive dashboard with light/dark themes and keyboard-accessible forms

## Technology

- HTML5 and CSS3
- Vanilla JavaScript ES modules
- sql.js for SQLite in the browser
- IndexedDB for the SQLite database and service-worker habit mirror
- Local Storage for session, theme, notification, and user-scoped mirror metadata
- Web App Manifest, Service Worker, and Web Notifications API

## Run Locally

Use a local HTTP server because ES modules and service workers require `localhost` or HTTPS:

```bash
python -m http.server 8000
```

Open http://localhost:8000/auth.html, create an account, and use the dashboard. Data remains in that browser profile.

## Deployment

The project is configured for GitHub Pages at `/HabitFlow/`. Publish the repository through GitHub Pages and open the HTTPS live URL above to install the PWA.

## Limitations

- Authentication is local browser authentication, not secure cloud authentication.
- Reminder checks run while the HabitFlow page is open or active. There is no Web Push server or guaranteed closed-app scheduling.
- Clearing browser site data removes the local account and stored habits.
- PDF export uses the browser print dialog; choose “Save as PDF” to create the file.
