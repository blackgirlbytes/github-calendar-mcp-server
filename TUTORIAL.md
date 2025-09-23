# GitHub Calendar MCP Server Tutorial

A complete guide to building and using the GitHub Calendar MCP Server - from basic setup to advanced interactive features.

## Table of Contents

1. [What You'll Learn](#what-youll-learn)
2. [Prerequisites](#prerequisites)
3. [Understanding the Architecture](#understanding-the-architecture)
4. [Step-by-Step Implementation](#step-by-step-implementation)
5. [Interactive UI Development](#interactive-ui-development)
6. [Integration with Goose](#integration-with-goose)
7. [Advanced Features](#advanced-features)
8. [Troubleshooting](#troubleshooting)
9. [Extending the Server](#extending-the-server)

## What You'll Learn

By the end of this tutorial, you'll understand how to:

- **Build a complete MCP server** from scratch using Node.js
- **Integrate with GitHub APIs** (GraphQL and REST)
- **Create interactive MCP-UI interfaces** with HTML, CSS, and JavaScript
- **Transform complex data** into visual calendar representations
- **Handle real-time user interactions** in sandboxed iframes
- **Deploy and configure** MCP servers with AI assistants like Goose

## Prerequisites

Before starting, ensure you have:

- **Node.js 16+** installed
- **GitHub Personal Access Token** with appropriate permissions
- **Basic JavaScript knowledge** (we'll explain MCP-specific concepts)
- **Goose Desktop** or another MCP-compatible client
- **Text editor** of your choice

## Understanding the Architecture

### MCP Server Components

Our GitHub Calendar MCP Server consists of several key components:

```
github-calendar-mcp-server/
├── index.js              # Main MCP server implementation
├── package.json           # Dependencies and configuration
├── README.md             # Setup and usage documentation
├── .env.example          # Environment variable template
└── TUTORIAL.md           # This comprehensive tutorial
```

### Data Flow Architecture

```
GitHub APIs → MCP Server → AI Assistant → User Interface
     ↑              ↓              ↓           ↓
Project Data → Calendar Events → Natural Language → Interactive UI
```

### Core Concepts

1. **MCP Tools**: Functions that the AI can call (like `get_calendar_events`)
2. **MCP-UI Resources**: Interactive HTML interfaces returned with tool responses
3. **GitHub Integration**: Dual API approach (GraphQL primary, REST fallback)
4. **Event Transformation**: Converting GitHub issues into calendar events
5. **Interactive Communication**: JavaScript `postMessage` for UI interactions

## Step-by-Step Implementation

### Step 1: Project Setup

First, create the project structure:

```bash
mkdir github-calendar-mcp-server
cd github-calendar-mcp-server
npm init -y
```

### Step 2: Install Dependencies

```bash
npm install @modelcontextprotocol/sdk @octokit/rest date-fns @mcp-ui/server
```

**What each dependency does:**
- `@modelcontextprotocol/sdk`: Core MCP server functionality
- `@octokit/rest`: GitHub API client
- `date-fns`: Date manipulation utilities
- `@mcp-ui/server`: Interactive UI resource creation

### Step 3: Configure Package.json

Update your `package.json` to use ES modules:

```json
{
  "name": "github-calendar-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  }
}
```

### Step 4: Basic MCP Server Structure

Create `index.js` with the basic MCP server framework:

```javascript
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

class GitHubCalendarMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'github-calendar-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // Tool definitions will go here
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GitHub Calendar MCP server running on stdio');
  }
}

const server = new GitHubCalendarMCPServer();
server.run().catch(console.error);
```

### Step 5: GitHub API Integration

Add GitHub API integration with dual approach:

```javascript
import { Octokit } from '@octokit/rest';

// In constructor:
this.octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// GraphQL query for Projects v2
getProjectV2Query() {
  return `
    query($org: String!, $projectNumber: Int!, $cursor: String) {
      organization(login: $org) {
        projectV2(number: $projectNumber) {
          items(first: 100, after: $cursor) {
            nodes {
              content {
                ... on Issue {
                  number
                  title
                  state
                  assignees(first: 10) {
                    nodes {
                      login
                      avatarUrl
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}
```

**Why dual API approach?**
- **GraphQL (Primary)**: More efficient, gets custom project fields
- **REST Search (Fallback)**: More reliable, works when GraphQL fails

### Step 6: Data Transformation

Transform GitHub data into calendar events:

```javascript
transformToCalendarEvents(items) {
  return items.map((item) => {
    const issue = item.content;
    
    // Extract dates from various sources
    let startDate = this.extractStartDate(item);
    let endDate = this.extractEndDate(item);
    
    // Fallback to created date if no start date
    if (!startDate) {
      startDate = new Date(issue.created_at);
    }

    return {
      id: `${issue.number}`,
      title: issue.title,
      startDate,
      endDate,
      url: issue.html_url,
      assignees: issue.assignees.map(a => ({
        login: a.login,
        avatar_url: a.avatar_url,
      })),
      status: issue.state,
      type: 'issue',
    };
  }).filter(event => event.startDate);
}
```

### Step 7: MCP Tool Implementation

Define your MCP tools:

```javascript
setupToolHandlers() {
  // Define available tools
  this.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_calendar_events',
          description: 'Get GitHub project calendar events with interactive UI',
          inputSchema: {
            type: 'object',
            properties: {
              assignee: {
                type: 'string',
                description: 'Filter by GitHub username',
              },
            },
          },
        },
        // ... more tools
      ],
    };
  });

  // Handle tool execution
  this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'get_calendar_events':
        return await this.handleCalendarEvents(args);
      // ... more handlers
    }
  });
}
```

## Interactive UI Development

### Understanding MCP-UI

MCP-UI allows servers to return rich, interactive HTML interfaces instead of just text. Key concepts:

1. **Sandboxed Iframes**: UIs run in secure, isolated environments
2. **PostMessage Communication**: JavaScript communicates with parent via messages
3. **Auto-resizing**: Interfaces automatically adjust to fit content
4. **Message Types**: Different ways to interact with the AI assistant

### Creating Interactive Calendar UI

```javascript
import { createUIResource } from '@mcp-ui/server';

createCalendarUI(events) {
  // Generate calendar grid
  const calendarGrid = this.generateCalendarGrid(events);
  
  // Generate interactive legend
  const assigneeLegend = this.generateAssigneeLegend(events);
  
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      /* Modern CSS styling */
      body { font-family: system-ui; background: #f8fafc; }
      .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
      .interactive-button { 
        cursor: pointer; 
        transition: background-color 0.2s;
      }
      .interactive-button:hover { background-color: #f3f4f6; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="calendar-grid">${calendarGrid}</div>
      <div class="legend">${assigneeLegend}</div>
      
      <!-- Interactive action buttons -->
      <div class="actions">
        <button onclick="refreshCalendar()">🔄 Refresh</button>
        <button onclick="showTeamStatus()">👥 Team Status</button>
        <button onclick="analyzeWorkload()">📊 Analyze</button>
      </div>
    </div>

    <script>
      // Auto-resize iframe
      new ResizeObserver(entries => {
        window.parent.postMessage({
          type: "ui-size-change",
          payload: { height: entries[0].contentRect.height + 50 }
        }, "*");
      }).observe(document.documentElement);

      // Interactive functions
      function refreshCalendar() {
        window.parent.postMessage({
          type: "prompt",
          payload: { prompt: "Refresh the calendar with latest data" }
        }, "*");
      }

      function showTeamStatus() {
        window.parent.postMessage({
          type: "prompt",
          payload: { prompt: "Show me the current team status" }
        }, "*");
      }

      function filterByAssignee(login) {
        window.parent.postMessage({
          type: "prompt",
          payload: { prompt: \`Show calendar events for \${login}\` }
        }, "*");
      }
    </script>
  </body>
  </html>
  `;
}
```

### MCP-UI Message Types

Understanding the different ways your UI can communicate:

```javascript
// 1. Prompt - Ask AI to process natural language
window.parent.postMessage({
  type: "prompt",
  payload: { prompt: "Show me team workload analysis" }
}, "*");

// 2. Link - Open external URL
window.parent.postMessage({
  type: "link",
  payload: { url: "https://github.com/user/repo/issues/123" }
}, "*");

// 3. Size Change - Resize iframe
window.parent.postMessage({
  type: "ui-size-change",
  payload: { height: 600 }
}, "*");
```

### Returning UI Resources

In your tool handlers, return both text and UI:

```javascript
case 'get_calendar_events': {
  const events = await this.getCalendarEvents();
  
  return {
    content: [
      {
        type: 'text',
        text: `Found ${events.length} calendar events`,
      },
      createUIResource({
        uri: `ui://calendar/${Date.now()}`,
        content: { 
          type: 'rawHtml', 
          htmlString: this.createCalendarUI(events) 
        },
        encoding: 'text'
      })
    ],
  };
}
```

## Integration with Goose

### Configuration

Add to your Goose MCP configuration:

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

### Environment Setup

Create `.env` file:

```bash
GITHUB_TOKEN=ghp_your_token_here
```

### Testing Integration

1. **Start Goose Desktop**
2. **Verify connection**: Check that your server appears in extensions
3. **Test basic functionality**: "Show me the team calendar"
4. **Test interactions**: Click buttons in the returned UI
5. **Verify data flow**: Ensure GitHub data loads correctly

## Advanced Features

### Workload Analysis

Implement intelligent team workload analysis:

```javascript
analyzeTeamWorkload(events) {
  const teamWorkload = {};
  const now = new Date();
  
  events.forEach(event => {
    if (event.status === 'closed') return;
    
    event.assignees.forEach(assignee => {
      if (!teamWorkload[assignee.login]) {
        teamWorkload[assignee.login] = {
          login: assignee.login,
          avatar_url: assignee.avatar_url,
          activeIssues: 0,
          upcomingIssues: 0,
          overdueIssues: 0,
          totalWorkload: 0
        };
      }
      
      const member = teamWorkload[assignee.login];
      member.activeIssues++;
      member.totalWorkload++;
      
      if (event.endDate && event.endDate < now) {
        member.overdueIssues++;
      }
      
      if (event.startDate > now) {
        member.upcomingIssues++;
      }
    });
  });
  
  return Object.values(teamWorkload)
    .sort((a, b) => a.totalWorkload - b.totalWorkload);
}
```

### Smart Assignment Recommendations

```javascript
findBestAssignee(workloadAnalysis) {
  if (workloadAnalysis.length === 0) return null;
  
  // Already sorted by workload (lightest first)
  const bestAssignee = workloadAnalysis[0];
  
  return {
    recommended: bestAssignee,
    reasoning: `${bestAssignee.login} has the lightest workload with ${bestAssignee.totalWorkload} active issues`,
    alternatives: workloadAnalysis.slice(1, 4)
  };
}
```

### Multi-day Event Spanning

Handle events that span multiple calendar days:

```javascript
generateCalendarGrid(events, currentDate) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Group events by date, handling multi-day spans
  const eventsByDate = {};
  
  events.forEach(event => {
    if (event.endDate && event.startDate.getTime() !== event.endDate.getTime()) {
      // Multi-day event - add to all days in range
      const eventStart = event.startDate > monthStart ? event.startDate : monthStart;
      const eventEnd = event.endDate < monthEnd ? event.endDate : monthEnd;
      
      const eventDays = eachDayOfInterval({ start: eventStart, end: eventEnd });
      eventDays.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
        eventsByDate[dateKey].push(event);
      });
    } else {
      // Single day event
      const dateKey = format(event.startDate, 'yyyy-MM-dd');
      if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
      eventsByDate[dateKey].push(event);
    }
  });
  
  return calendarDays.map(day => this.renderCalendarDay(day, eventsByDate));
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. "Authentication failed" Error

**Problem**: GitHub API returns 401 Unauthorized

**Solutions**:
- Verify `GITHUB_TOKEN` environment variable is set
- Check token permissions (needs `repo`, `read:org`, `read:project`)
- Ensure token hasn't expired
- Test token with: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`

#### 2. "Project not found" Error

**Problem**: Cannot access GitHub project board

**Solutions**:
- Verify organization name and project number
- Check if project is public or if token has access
- Try using Search API fallback instead of GraphQL
- Confirm project exists: visit `https://github.com/orgs/ORG/projects/NUMBER`

#### 3. UI Not Interactive

**Problem**: Buttons don't work in MCP-UI

**Solutions**:
- Check browser console for JavaScript errors
- Verify `postMessage` calls are correct
- Ensure Goose supports the message types you're using
- Test with simple `alert()` first (though this may be blocked in sandbox)

#### 4. Calendar Shows No Events

**Problem**: Calendar renders but no events appear

**Solutions**:
- Check date filtering (default is August 2025+)
- Verify label filtering matches your issues
- Check if issues have required assignees
- Add debug logging to data transformation

#### 5. Server Won't Start

**Problem**: MCP server fails to initialize

**Solutions**:
- Check Node.js version (requires 16+)
- Verify all dependencies installed: `npm install`
- Check for syntax errors: `node --check index.js`
- Ensure `"type": "module"` in package.json

### Debug Mode

Add debugging to your server:

```javascript
// Add to constructor
this.debug = process.env.DEBUG === 'true';

// Use throughout code
if (this.debug) {
  console.error('Debug: Fetched', items.length, 'items from GitHub');
}

// Start with debugging
DEBUG=true npm start
```

### Testing Without Goose

Create a simple test script:

```javascript
// test.js
import { spawn } from 'child_process';

const server = spawn('node', ['index.js']);

// Test list tools
const listToolsMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
};

server.stdin.write(JSON.stringify(listToolsMessage) + '\n');

server.stdout.on('data', (data) => {
  console.log('Response:', data.toString());
});

setTimeout(() => server.kill(), 5000);
```

## Extending the Server

### Adding New Tools

To add a new MCP tool:

1. **Define the tool** in `ListToolsRequestSchema` handler
2. **Implement the logic** in `CallToolRequestSchema` handler
3. **Create UI component** if needed
4. **Test with natural language** commands

Example - Adding issue creation:

```javascript
// In ListToolsRequestSchema:
{
  name: 'create_issue',
  description: 'Create a new GitHub issue',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Issue title' },
      body: { type: 'string', description: 'Issue description' },
      assignee: { type: 'string', description: 'GitHub username to assign' }
    },
    required: ['title']
  }
}

// In CallToolRequestSchema:
case 'create_issue': {
  const { title, body, assignee } = args;
  
  const issue = await this.octokit.rest.issues.create({
    owner: 'your-org',
    repo: 'your-repo',
    title,
    body,
    assignees: assignee ? [assignee] : []
  });
  
  return {
    content: [{
      type: 'text',
      text: `Created issue #${issue.data.number}: ${title}`
    }]
  };
}
```

### Custom Data Sources

Extend beyond GitHub:

```javascript
// Add Jira integration
async fetchJiraIssues() {
  const response = await fetch('https://your-domain.atlassian.net/rest/api/2/search', {
    headers: {
      'Authorization': `Basic ${Buffer.from('email:token').toString('base64')}`,
      'Content-Type': 'application/json'
    }
  });
  return response.json();
}

// Combine multiple data sources
async getAllEvents() {
  const [githubEvents, jiraEvents] = await Promise.all([
    this.getCalendarEvents(),
    this.getJiraEvents()
  ]);
  
  return [...githubEvents, ...jiraEvents].sort((a, b) => a.startDate - b.startDate);
}
```

### Advanced UI Components

Create reusable UI components:

```javascript
createProgressBar(percentage, color = '#3b82f6') {
  return `
    <div style="background: #f3f4f6; border-radius: 8px; height: 8px; overflow: hidden;">
      <div style="background: ${color}; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
    </div>
  `;
}

createUserAvatar(user, size = 32) {
  return `
    <img src="${user.avatar_url}" 
         alt="${user.login}" 
         style="width: ${size}px; height: ${size}px; border-radius: 50%;" 
         title="${user.login}">
  `;
}

createStatusBadge(status) {
  const colors = {
    open: '#10b981',
    closed: '#6b7280',
    'in-progress': '#f59e0b'
  };
  
  return `
    <span style="background: ${colors[status] || '#6b7280'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
      ${status}
    </span>
  `;
}
```

### Performance Optimization

Implement caching and optimization:

```javascript
class GitHubCalendarMCPServer {
  constructor() {
    // ... existing code
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async getCalendarEventsWithCache(org, project, sinceDate) {
    const cacheKey = `${org}-${project}-${sinceDate?.toISOString()}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const data = await this.getCalendarEvents(org, project, sinceDate);
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    
    return data;
  }
}
```

## Best Practices

### Code Organization

```javascript
// Separate concerns into methods
class GitHubCalendarMCPServer {
  // API methods
  async fetchProjectItems() { /* ... */ }
  async fetchIssuesByLabel() { /* ... */ }
  
  // Data transformation
  transformToCalendarEvents() { /* ... */ }
  analyzeTeamWorkload() { /* ... */ }
  
  // UI generation
  createCalendarUI() { /* ... */ }
  createTeamStatusUI() { /* ... */ }
  
  // MCP handlers
  setupToolHandlers() { /* ... */ }
}
```

### Error Handling

```javascript
async handleToolCall(name, args) {
  try {
    switch (name) {
      case 'get_calendar_events':
        return await this.handleCalendarEvents(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error in tool ${name}:`, error);
    
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
}
```

### Security Considerations

1. **Validate all inputs** from tool parameters
2. **Sanitize HTML content** in UI generation
3. **Use environment variables** for sensitive data
4. **Implement rate limiting** for API calls
5. **Handle authentication errors** gracefully

### Testing Strategy

```javascript
// Unit tests for data transformation
describe('transformToCalendarEvents', () => {
  it('should convert GitHub issues to calendar events', () => {
    const mockItems = [/* mock data */];
    const events = server.transformToCalendarEvents(mockItems);
    expect(events).toHaveLength(mockItems.length);
    expect(events[0]).toHaveProperty('startDate');
  });
});

// Integration tests for GitHub API
describe('GitHub API integration', () => {
  it('should fetch project items', async () => {
    const items = await server.fetchProjectItems('testorg', 123);
    expect(Array.isArray(items)).toBe(true);
  });
});
```

## Conclusion

You've now learned how to build a complete, interactive MCP server that:

- ✅ **Integrates with GitHub APIs** for real-time project data
- ✅ **Provides interactive UIs** with MCP-UI components  
- ✅ **Handles complex data transformations** for calendar visualization
- ✅ **Supports natural language interactions** through AI assistants
- ✅ **Implements advanced features** like workload analysis and smart recommendations

### Next Steps

1. **Deploy your server** and integrate with Goose
2. **Customize for your team's** specific needs and workflows
3. **Add additional data sources** (Jira, Linear, etc.)
4. **Implement advanced features** like notifications and automation
5. **Share your server** with the MCP community

### Resources

- **MCP Documentation**: [https://modelcontextprotocol.io](https://modelcontextprotocol.io)
- **GitHub API Docs**: [https://docs.github.com/en/rest](https://docs.github.com/en/rest)
- **Goose Documentation**: [https://github.com/block/goose](https://github.com/block/goose)
- **MCP-UI Examples**: [https://github.com/modelcontextprotocol/mcp-ui](https://github.com/modelcontextprotocol/mcp-ui)

Happy building! 🚀
