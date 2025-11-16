
# LightTaskSheet — Enhanced Edition

A modern, lightweight internal spreadsheet-style task tracker with advanced features and beautiful UI.

## ✨ Features

### 🔐 Authentication & User Management
- Multi-user authentication with JWT tokens
- Password reset functionality
- Admin panel for user management
- Persistent login sessions (survives page refresh)
- Default admin user (username: `admin`, password: `admin123`)

### 📊 Task Management
- **Hierarchical task structure** with unlimited nesting levels
- **Visual indentation** for sub-tasks (1, 1.1, 1.1.1, etc.)
- **Status tracking** with dropdown (To be started, In Progress, Pending, Completed)
- **Collapse/expand** functionality for parent tasks
- **Auto-numbering** with clear visual hierarchy

### 📝 Data Input & Editing
- **Multiple column types**: Text, Date, Number, Dropdown
- **Resizable columns** for flexible layout
- **Text wrapping** with auto-expanding text areas
- **Tab navigation** that creates new rows automatically
- **Keyboard shortcuts** for productivity

### 💾 Data Management
- **JSON-backed storage** (one file per user)
- **Export options**: JSON with hierarchy info, Excel/CSV with indentation
- **Import functionality** with backward compatibility
- **Auto-migration** for existing users (adds new features automatically)

### ⌨️ Keyboard Shortcuts
- **Ctrl + Enter** — Add new row
- **Tab** (from last column) — Add new row at same hierarchy level
- **Ctrl + S** — Save
- **Ctrl + E** — Export JSON

### 🎨 Modern UI
- **Clean, professional design** with modern styling
- **Responsive layout** that works on all devices
- **Fast loading** with optimized lightweight CSS
- **Transparent backgrounds** and smooth interactions
- **Protected columns** (Status column cannot be deleted)

## 🚀 Quick Start

### Installation
```sh
npm install
```

### Run Server
```sh
npm start
```
Server runs on http://localhost:3000

### Default Login
- **Username**: `admin`
- **Password**: `admin123`

## 📁 Project Structure

```
lighttasksheet-v1/
├── server.js          # Express server with API endpoints
├── package.json       # Dependencies and scripts
├── data/             # User data storage (JSON files)
├── public/           # Frontend files
│   ├── index.html    # Main application (enhanced version)
│   ├── style.css     # Base styling
│   └── script.js     # Original JavaScript (reference)
└── scripts/          # Utility scripts
    └── backup_data.sh # Data backup script
```

## 🔧 API Endpoints

- `POST /api/register` - Create new user
- `POST /api/login` - User authentication
- `POST /api/reset-password` - Reset user password
- `GET /api/sheet/:username` - Load user's sheet
- `POST /api/sheet/:username` - Save user's sheet
- `GET /api/admin/users` - List all users (admin only)
- `POST /api/admin/delete-user` - Delete user (admin only)

## 💾 Backup

```sh
npm run backup
```
Backups are stored in `backups/` as timestamped copies of the `data/` folder.

## 🛠️ Technical Details

- **Backend**: Node.js + Express
- **Authentication**: JWT with bcrypt password hashing
- **Storage**: File-based JSON (no database required)
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Styling**: Modern CSS with system fonts for fast loading

## 🎯 Use Cases

- **Project management** with hierarchical task breakdown
- **Team collaboration** with multi-user support
- **Progress tracking** with status indicators
- **Data export** for reporting and analysis
- **Internal tools** that need quick deployment

## 🔒 Security Features

- Password hashing with bcrypt
- JWT token-based authentication
- Admin-only user management
- Protected system columns
- Input validation and sanitization

---

**Made with ❤️ using Amazon Q**
