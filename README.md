# Xlegacy Telegram Bot - King-MD Session ID Generator

This is a Telegram bot designed to help you generate a King-MD Session ID for your WhatsApp bot deployment. It supports both 8-digit pairing codes and QR code scanning methods.

## Features

- **Session ID Generation:** Easily obtain a session ID for King-MD WhatsApp bots.
- **Two Pairing Methods:** Choose between entering an 8-digit pairing code or scanning a QR code.
- **Secure Credential Upload:** Sessions are securely uploaded to Mega.nz, and a shareable link (Session ID) is provided.
- **GitHub Actions Integration:** The bot can be run on GitHub Actions for a specified duration, allowing for remote session generation.
- **Automatic Module Installation:** Ensures all necessary Node.js modules are installed.
- **Robust Error Handling:** Includes checks for environment variables and connection status.

## Getting Started

### Prerequisites

Before running this bot, you need to set up the following:

1.  **Telegram Bot Token:** Create a new bot with BotFather on Telegram and obtain your `TELEGRAM_BOT_TOKEN`.
2.  **Mega.nz Account:** You'll need a Mega.nz account for secure storage of session credentials. Obtain your `MEGA_EMAIL` and `MEGA_PASS`.
3.  **GitHub Repository:** Host this project on a GitHub repository.

### Environment Variables

The bot relies on the following environment variables, which **must be set as GitHub Secrets** in your repository:

-   `TELEGRAM_BOT_TOKEN`: Your Telegram bot's API token.
-   `MEGA_EMAIL`: Your Mega.nz account email.
-   `MEGA_PASS`: Your Mega.nz account password.

**How to add GitHub Secrets:**
1. Go to your repository on GitHub.
2. Click on `Settings`.
3. In the left sidebar, click on `Secrets and variables` > `Actions`.
4. Click on `New repository secret` for each of the above and enter their respective values.

### Local Setup (for development/testing)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/YourGitHubUsername/Xlegacy.git
    cd Xlegacy
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create a `.env` file:**
    Create a file named `.env` in the root of your project and add your credentials:
    ```
    TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
    MEGA_EMAIL=YOUR_MEGA_EMAIL
    MEGA_PASS=YOUR_MEGA_PASS
    ```
    *(Note: For local testing, you might need to install `dotenv` package: `npm install dotenv` and `require('dotenv').config()` at the top of `bot.js`)*
4.  **Run the bot:**
    ```bash
    node bot.js
    ```

## Usage with Telegram

Interact with your bot on Telegram using the following commands:

-   `/start`: Displays a welcome message and instructions.
-   `/code <Your WhatsApp Number>`: Initiates pairing using an 8-digit code. Replace `<Your WhatsApp Number>` with your full WhatsApp number including country code (e.g., `/code 254712345678`).
-   `/qr`: Initiates pairing by sending a QR code for you to scan with your WhatsApp app.
-   `/cancel`: Stops any active pairing process and cleans up temporary files.

## Running on GitHub Actions

This project includes a GitHub Actions workflow (`.github/workflows/bot.yml`) that allows you to run the bot directly on GitHub's servers.

1.  **Commit and Push:** Ensure your `bot.js`, `package.json`, `.gitignore`, and the workflow file are committed and pushed to your GitHub repository.
2.  **Trigger Workflow:**
    -   Go to the `Actions` tab in your GitHub repository.
    -   Select the workflow named `Run Xlegacy Telegram Bot`.
    -   Click the `Run workflow` button on the right.
    -   You can specify `duration_minutes` (default is 60 minutes) to control how long the bot runs.
    -   Click `Run workflow` to start the bot.
3.  **Monitor:** You can monitor the bot's output and status in the workflow run logs on GitHub.

## Contributing

Feel free to fork the repository, make improvements, and submit pull requests.

## License

This project is licensed under the ISC License. See the `LICENSE` file for details. (Note: A LICENSE file would be a good next step if you haven't created one yet.)
