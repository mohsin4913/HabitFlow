# HabitFlow

HabitFlow is a focused daily habit tracker for building consistent routines with clear progress feedback, persistent streaks, and offline support.

## Features

- **Daily Check-ins**: Add, edit, complete, skip, and organize habits by category and schedule.
- **Streak Engine**: Tracks current streaks, longest streaks, completion history, and perfect days.
- **Weekly Progress Analytics**: See daily completion rates, weekly averages, total check-ins, and quick stats.
- **Offline-First PWA**: Install HabitFlow from the browser. The service worker precaches the app shell and IndexedDB mirrors habit state for offline use.
- **Interactive Notifications**: Habit reminders include **Done**, **Snooze**, and **Skip** actions. Done updates the habit and streak, Snooze schedules the reminder again after ten minutes, and Skip records a skipped day without extending the streak.
- **Presentation Data Controls**: First visits receive starter habits, while **Load sample week** and **Reset demo** provide clean presentation states.
- **Responsive UI**: The dashboard supports desktop, tablet, and narrow mobile layouts with keyboard-friendly dialogs and visible focus states.

## Tech Stack

- HTML5 and semantic browser UI
- CSS3 with responsive layout and Swiss-editorial styling
- Vanilla JavaScript using ES modules
- SQLite in the browser through sql.js
- IndexedDB for the SQLite database, habit mirror, and service-worker actions
- Web App Manifest and Service Worker for PWA installation and offline caching
- Web Notifications API for reminder actions

## Run Locally

Use a local HTTP server because ES modules and service workers require a secure context such as `localhost` or HTTPS.

```bash
python -m http.server 8000
```

Open `http://localhost:8000/index.html` in a modern browser. Register an account, allow notifications from the dashboard, and use the settings controls to load presentation data.

## GitHub Pages

The manifest is configured for the `/HabitFlow/` GitHub Pages path. Publish the repository as a GitHub Pages site, then open the deployed HTTPS URL to install the PWA and enable service-worker notifications.
