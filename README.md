# GitHub Calendar MCP Server

A Model Context Protocol (MCP) server that provides GitHub project calendar and team management capabilities. This server allows AI assistants like Goose to interact with GitHub project boards, analyze team workloads, and provide scheduling insights.

<a href="https://glama.ai/mcp/servers/@blackgirlbytes/github-calendar-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@blackgirlbytes/github-calendar-mcp-server/badge" alt="GitHub Calendar Server MCP server" />
</a>

## Features

- 📅 **Calendar Events**: Fetch GitHub project issues as calendar events
- 👥 **Team Status**: Get current status of all team members
- 📊 **Workload Analysis**: Analyze team workload distribution
- 🎯 **Smart Assignment**: Find the best team member for new tasks
- 📋 **Personal Schedules**: Get individual team member schedules
- 🔍 **Flexible Filtering**: Filter by organization, project, dates, and assignees

## Installation

1. **Clone or create the project directory**:
   ```bash
   mkdir github-calendar-mcp-server
   cd github-calendar-mcp-server
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file or set environment variables:
   ```bash
   export GITHUB_TOKEN=your_github_personal_access_token
   ```

   To create a GitHub token:
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Create a new token with these permissions:
     - `repo` (for private repositories)
     - `read:org` (for organization data)
     - `read:project` (for project boards)

## Usage

### Running the Server

```bash
npm start
```

The server will start and listen for MCP connections on stdio.

### Integration with Goose

Add this configuration to your Goose MCP settings:

```json
{
  "mcpServers": {
    "github-calendar": {
      "command": "node",
      "args": ["/full/path/to/github-calendar-mcp-server/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

### Available Tools

#### 1. `get_team_status`
Get current status of all development team members.

**Example prompts:**
- "What's the current team status?"
- "Show me how busy everyone is"
- "Get team workload overview"

#### 2. `get_person_schedule`
Get schedule for a specific team member.

**Parameters:**
- `login` (required): GitHub username
- `days` (optional): Number of days to look ahead (default: 7)

**Example prompts:**
- "What's Alice's schedule for the next week?"
- "Show me Bob's upcoming work for the next 14 days"

#### 3. `analyze_workload`
Analyze team workload distribution.

**Example prompts:**
- "Analyze the team workload"
- "Who has the most/least work?"
- "Show me workload distribution"

#### 4. `find_best_assignee`
Find the team member with the lightest workload.

**Example prompts:**
- "Who should I assign this new task to?"
- "Find the best person for a new assignment"
- "Who has the lightest workload?"

#### 5. `get_calendar_events`
Get GitHub project calendar events with filtering options.

**Parameters:**
- `org` (optional): GitHub organization (default: "squareup")
- `project` (optional): Project number (default: 333)
- `since` (optional): ISO date string to filter from (default: "2025-08-01")
- `assignee` (optional): Filter by GitHub username

**Example prompts:**
- "Show me all calendar events"
- "Get events for Alice"
- "Show me events since September 2025"
- "Get calendar events for the design team project"

## Configuration

The server is pre-configured for:
- **Organization**: `squareup`
- **Project**: `333`
- **Label Filter**: `area: devrel-opensource`
- **Date Range**: From August 2025 onwards

You can modify these defaults in the `index.js` file:

```javascript
const DEFAULT_ORG = 'your-org';
const DEFAULT_PROJECT_NUMBER = 123;
const DEFAULT_LABEL = 'your-label';
```

## Data Sources

The server fetches data from:
1. **GitHub Projects v2 API** (GraphQL) - Primary source
2. **GitHub Search API** - Fallback if GraphQL fails
3. **Issue custom fields** - For start/end dates
4. **Issue body parsing** - Backup date extraction
5. **Milestone due dates** - Additional date source

## Error Handling

The server includes comprehensive error handling:
- **Authentication errors**: Clear messages about GitHub token issues
- **API rate limits**: Graceful handling of GitHub API limits
- **Network issues**: Fallback between GraphQL and REST APIs
- **Missing data**: Sensible defaults for incomplete information

## Example Interactions

```
You: "What's the team status?"
Goose: "Here's the current team status:

**alice** 
- Active Issues: 3
- Upcoming Issues: 1  
- Overdue Issues: 0
- Total Workload: 4

**bob**
- Active Issues: 1
- Upcoming Issues: 2
- Overdue Issues: 1  
- Total Workload: 4"

You: "Who should I assign a new task to?"
Goose: "**alice** has the lightest workload:
- Current workload: 2 issues
- Active: 2
- Upcoming: 0
- Overdue: 0"

You: "Show me Bob's schedule for next week"
Goose: "# Schedule for bob (Next 7 days)

**Fix login bug** (open)
- Start: Sep 23, 2025
- End: Sep 25, 2025  
- URL: https://github.com/org/repo/issues/123"
```

## Troubleshooting

### Common Issues

1. **"Authentication failed" error**:
   - Verify your `GITHUB_TOKEN` is set correctly
   - Check that the token has required permissions
   - Ensure the token hasn't expired

2. **"Project not found" error**:
   - Verify the organization and project number
   - Check that your token has access to the project
   - Ensure the project exists and is accessible

3. **"No events found" error**:
   - Check the date range (default starts from Aug 2025)
   - Verify the label filter matches your issues
   - Ensure issues exist with the specified criteria

4. **Server doesn't start**:
   - Run `npm install` to ensure dependencies are installed
   - Check Node.js version (requires 16+)
   - Verify the `index.js` file has execute permissions

### Debug Mode

For debugging, you can add console logging by modifying the server code or checking the error output when running the server.

## Development

To extend the server:

1. **Add new tools**: Modify the `setupToolHandlers()` method
2. **Add new data sources**: Extend the GitHub API integration
3. **Add UI components**: Integrate with `@mcp-ui/server` for interactive interfaces
4. **Add caching**: Implement Redis or file-based caching for better performance

## License

MIT License - feel free to modify and distribute as needed.