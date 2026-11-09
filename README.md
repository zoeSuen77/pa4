# ICSI 418Y — Programming Assignment 4

## User Stories and Project Backlogs

This application extends PA3's React, Express, and MongoDB project application with user stories and a separate backlog for each project. The application builds on PA3; the default `pa3` database name is retained for compatibility. This repository contains the PA4 project.

### Features

- Register users and verify login credentials using salted password hashes.
- Create a project with a name, description, status, and an existing user as project lead.
- Choose a status of `Planning`, `Active`, or `Completed`.
- View projects with readable lead names.
- Add the project lead as a member automatically when the project is created.
- View, add, and remove project members; users may belong to multiple projects.
- Reject duplicate memberships and prevent removal of the current project lead.
- Create stories with a title, description, priority, and a current project member or `Unassigned`; the server sets new stories to `To Do`.
- View every story, including `Done`, with its full description, priority, status, and readable assignee.
- Edit all five story fields, reopen completed stories, cancel without saving, and confirm deletion.
- Clear story forms when switching projects; preserve drafts after failed saves and background refreshes.
- Reject removal of a member assigned any story in that project, including `Done`. Assignments in other projects do not block removal.
- Display success and error feedback for validation, network, and database failures.

Login retains PA2's credential verification behavior. Persistent login sessions and API authorization are outside this implementation's scope.

## Running the application

**Requirements:** Node.js 22.12 or newer and npm.

```bash
git clone https://github.com/zoeSuen77/pa4.git
cd pa4
npm ci
npm run demo
```

Open [http://localhost:5173](http://localhost:5173). The Express API runs at `http://localhost:9000`. Press **Ctrl+C** in the terminal to stop the application.

`npm run demo` starts the frontend, backend, and a real local MongoDB replica set on port `27018`. The first run downloads MongoDB 7.0.14 and requires internet access. Later runs reuse the downloaded binary. Records persist in `.local-data/mongo`. Atlas credentials are not required for this mode.

### Sample data

With the application running, use a second terminal in the project directory:

```bash
npm run demo:seed
```

This prepares the three accounts below, two **PA4** projects, and six stories through the application's APIs. It does not change the old PA3 projects **Campus Planner** and **Study Together**. Existing accounts keep their current names and passwords; the password below applies only to accounts newly created by this script. An existing account with different display names is reported for review.

| Username | Name | Password for a newly created sample account |
| --- | --- | --- |
| `alex_chen` | Alex Chen | `CampusDemo123!` |
| `maya_patel` | Maya Patel | `CampusDemo123!` |
| `sam_rivera` | Sam Rivera | `CampusDemo123!` |

| Project | Lead | Other members |
| --- | --- | --- |
| **PA4 Campus Planner** | Alex Chen | Maya Patel, Sam Rivera |
| **PA4 Study Together** | Maya Patel | None |

| Sample | Project | Story title | Priority | Status | Assigned member |
| --- | --- | --- | --- | --- | --- |
| S1 | PA4 Campus Planner | View campus event details | High | To Do | Alex Chen |
| S2 | PA4 Campus Planner | Publish event schedule | Medium | Done | Sam Rivera |
| S3 | PA4 Campus Planner | Filter campus events | Low | In Progress | Unassigned |
| S4 | PA4 Study Together | Create study groups | High | In Progress | Maya Patel |
| S5 | PA4 Study Together | View study group details | Low | Done | Unassigned |
| S6 | PA4 Campus Planner | Remove outdated event notice | Low | To Do | Unassigned |

Every description follows `As a ..., I want ..., so that ...`. All new stories are first created as `To Do`; the script then uses the edit API to set the other sample statuses. Sam has only a `Done` assignment in Campus Planner, making it possible to demonstrate that completed stories still prevent removal. Maya has no assignments in Campus Planner, so her assignment in Study Together does not prevent removal from Campus Planner.

#### Repeating the setup and preserving edits

The script adds missing samples without clearing the database or overwriting existing records. A local manifest in `.local-data/seed-manifests/` tracks sample project and story IDs for each API address. Keep it with the persistent database: it lets the script recognize a story even after you rename it. This file contains IDs, not passwords, and is ignored by Git.

- Existing stories keep manually edited titles, descriptions, priorities, statuses, and assignments. Differences are reported instead of reset.
- A member removed after the initial setup stays removed. The script reports the missing membership instead of silently adding the member back.
- Deleted sample stories can be recreated on a later run. Therefore, do not rerun the seed command between recording a deletion and showing that deletion after refresh.
- Duplicate project names, an unexpected project lead, or ambiguous matching stories are reported. The affected samples are skipped rather than attached to an arbitrary project.
- Exit code `0` means the expected setup is ready; `2` means there are differences or conflicts to review; `1` means a request or local file operation failed. A warning does not mean saved edits were erased.

To restore the planned recording state, use the report's repair instructions: select the named PA4 project, restore missing members with **Add member**, and edit the affected stories to match the table. Restore exact descriptions from `scripts/demo-data.cjs`. If a project name/lead conflicts, use the IDs in the report to identify the intended record and resolve the conflict deliberately; the script does not rename projects or remove unrelated records. Rerun `npm run demo:seed` to verify. Keep the manifest; deleting it loses tracking of renamed samples.

If you intentionally use another local port, point the seed command at that API, for example:

```bash
DEMO_API_URL=http://127.0.0.1:9013 npm run demo:seed
```

The API address identifies the default manifest. Use the same address spelling on repeated runs. If you switch to a different database behind the same API address (for example, local MongoDB versus Atlas), use a different manifest explicitly:

```bash
DEMO_MANIFEST_PATH=.local-data/seed-manifests/pa4-atlas.json npm run demo:seed
```

Keep using that override for that database. The programmatic helper also accepts `seedDemo(base, { manifestPath })`.

### MongoDB Atlas configuration

To use Atlas, stop the local application, copy `server/.env.example` to `server/.env`, and set `MONGO_URI` to the connection string for a transaction-capable deployment. Allow the current IP address in Atlas network access. Then run:

```bash
npm run dev
```

The default database is `pa3`, with collections `Users`, `Projects`, `ProjectMemberships`, and `UserStories`. To reuse an existing PA2 database, set `DB_NAME=pa2` and `USERS_COLLECTION=users` alongside its connection string. Existing user IDs and password hashes remain usable. Run the same seed command against the Express API after starting this mode; it does not connect directly to Atlas.

The optional `client/.env` variable `VITE_API_URL` overrides the default API URL, `http://localhost:9000`. Environment files are excluded from Git; `.env.example` files contain configuration placeholders.

## Database design

| Collection | Fields |
| --- | --- |
| `Users` | `_id`, `f_name`, `l_name`, `username`, `password` |
| `Projects` | `_id`, `name`, `description`, `status`, `project_lead_id` |
| `ProjectMemberships` | `_id`, `project_id`, `user_id` |
| `UserStories` | `_id`, `project_id`, `title`, `description`, `priority`, `status`, `assigned_user_id` |

All IDs and relationship references are stored as MongoDB **ObjectIds**; an unassigned story uses `assigned_user_id: null`. The backend converts validated JSON ID strings into ObjectIds before database operations. User names are retrieved for display rather than stored as relationship keys. Story priorities are `High`, `Medium`, and `Low`; story statuses are `To Do`, `In Progress`, and `Done`.

A transaction saves each project together with its lead membership. A unique compound index on `{ project_id: 1, user_id: 1 }` prevents duplicate memberships, including concurrent requests. The backend checks the lead ID before removing a member. The `username` index is also unique, and public API responses exclude password hashes.

Inspect local database documents while the application is running:

```bash
npm run db:inspect -- --local
# Canonical Extended JSON displays ObjectIds as { "$oid": "..." }.
npm run db:inspect -- --local --ejson
```

Both commands show all four collections, including assigned and unassigned story references, with up to 50 records per collection. User output includes only public fields; password hashes are never printed. `npm run db:users -- --local` still shows users only. For Atlas, omit `--local` to use `server/.env`. For a custom local setup, pass the same `PA3_MONGO_PORT` and `PA3_DB_NAME` values used by the launcher.

Alternatively, connect MongoDB Compass to `mongodb://127.0.0.1:27018/?directConnection=true` and select `pa3`. Do not delete `.local-data/mongo` to restart the app: stop with Ctrl+C and run `npm run demo` again to retain the saved records.

## API

| Method and path | Request fields | Operation |
| --- | --- | --- |
| `POST /signup` | `f_name`, `l_name`, `username`, `password` | Register a user |
| `POST /login` | `username`, `password` | Verify credentials |
| `GET /users` | — | List public user information |
| `POST /projects` | `name`, `description`, `status`, `project_lead_id` | Create a project and its lead membership |
| `GET /projects` | — | List projects with lead information and member counts |
| `GET /projects/:id/members` | — | List project members |
| `POST /projects/:id/members` | `user_id` | Add a registered user |
| `DELETE /projects/:id/members/:userId` | — | Remove a non-lead member |
| `GET /projects/:projectId/stories` | — | List all stories in the project |
| `POST /projects/:projectId/stories` | `title`, `description`, `priority`, `assigned_user_id` | Create a story with server-controlled `To Do` status |
| `PUT /projects/:projectId/stories/:storyId` | `title`, `description`, `priority`, `status`, `assigned_user_id` | Update the existing story in its original project |
| `DELETE /projects/:projectId/stories/:storyId` | — | Delete a story in this project |

The server validates required fields, text lengths where bounded, enums, ID formats, and referenced records. Story assignees must exist and be current members of the same project. Story IDs and project IDs are immutable, and update/delete queries match both IDs. Invalid input returns `400`; invalid login credentials return `401`; lead removal returns `403`; missing records return `404`; duplicates or removal of a member with assigned stories return `409`; unexpected server/database failures return `500`. Responses include messages displayed by the frontend.

## Tests

```bash
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

An installed Google Chrome browser can be used with `PLAYWRIGHT_CHANNEL=chrome npm run test:ui`.

Latest automated verification (2026-11-09): **75 API/data-tool tests, all 22 browser tests, and the production build passed**. Coverage includes PA3 behavior, story CRUD, ObjectId relationships, assignment validation, member-removal rules, project isolation, cancellation, failed-request draft retention, persistence, mobile layout, and repeatable demo-data preparation. Manual acceptance completed on 2026-11-09, including creation, editing, cancellation, confirmed deletion and refresh, project switching, member-removal restrictions, and connection failure/retry.

The demo-data regression tests can also be run separately with `node --test tests/demo-data.test.cjs`.

Stage E validation (2026-11-08): **11 demo-data and inspection tests passed**. On the saved local database, setup created two PA4 projects and six stories while retaining every original record and account password. A second run created nothing and left all records unchanged. Both seed runs and `npm run db:inspect -- --local --ejson` exited successfully.

API tests use temporary MongoDB instances. Browser tests use ports `5174`, `9001`, and `27019` with the separate `pa3_ui_test` database, preserving the local application's records.

## Source structure

```text
client/src/
  App.jsx                           Account and project navigation
  components/Login.jsx              Login form
  components/Signup.jsx             Registration form
  components/ProjectsWorkspace.jsx  Project creation, listing, and memberships
  components/ProjectBacklog.jsx     Story list, requests, and project isolation
  components/StoryForm.jsx          Create/edit drafts and member selection
  api.js                            Shared HTTP request helper
server/
  app.js                            Express setup, signup/login, error handling
  projects.js                       Project and membership routes
  stories.js                        Story routes and assignment validation
  database.js                       Collections and unique indexes
  server.js                         Configuration and database connection
  passwords.js                      Password hashing and verification
scripts/                            Local startup, sample data, database inspection
tests/                              API integration and browser tests
```
