# Contributing to JobReactor

Thank you for your interest in contributing to **JobReactor**! We welcome contributions of all sizes—from fixing typos in the documentation to submitting complete features.

Please review the guidelines below to ensure a smooth and productive workflow.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites
Before you start, make sure you have the following installed on your local machine:
- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher)
- **Redis** (v6.x or higher) OR **Docker** (recommended)

### Local Development Setup

1. **Fork & Clone**
   Fork the repository on GitHub, then clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/job-reactor.git
   cd job-reactor
   ```

2. **Install Dependencies**
   Install the root dependencies and dashboard dependencies:
   ```bash
   # Install backend dependencies
   npm install

   # Install frontend dashboard dependencies
   cd dashboard
   npm install
   cd ..
   ```

3. **Configure Environment**
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Modify `.env` to match your local setup if you are not using default Redis settings.

4. **Run Services**
   If you have **Docker Compose** installed, you can spin up the complete environment (Redis, Workers, API, Dashboard) with a single command:
   ```bash
   docker-compose up --build
   ```
   
   If running **locally** without Docker:
   - Ensure a local Redis server is running (`redis-server`).
   - Start the background worker process:
     ```bash
     npm run worker
     ```
   - Start the API server:
     ```bash
     npm run api
     ```
   - Start the React dashboard:
     ```bash
     cd dashboard
     npm run dev
     ```

---

## Coding Standards & Style

We follow clean, standard JavaScript patterns. Here are some key patterns to maintain:
- Use ES6+ syntax where appropriate.
- Ensure all Redis interactions that must be atomic are implemented via **Lua scripts** in the `scripts/` folder.
- Ensure proper lock management for workers; long-running processes must emit heartbeats.
- Keep components in the Vite/React dashboard focused and modular.

---

## Submitting a Pull Request (PR)

1. **Create a Branch**: Create a descriptive topic branch off `main`:
   ```bash
   git checkout -b feature/your-awesome-feature
   ```
2. **Make Your Changes**: Keep commits atomic and write clear, concise commit messages.
3. **Run Verification**: Ensure everything starts up, runs, and is formatted.
4. **Push & Open PR**: Push your branch to your fork and open a Pull Request against our `main` branch.
5. **PR Review**: Provide a detailed description of the changes in the PR template. A maintainer will review your code shortly.

Thanks again for contributing! 🚀
