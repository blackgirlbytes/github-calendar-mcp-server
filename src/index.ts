#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { TeamStatusTool } from './tools/team-status.js';
import { PersonScheduleTool } from './tools/person-schedule.js';
import { WorkloadAnalysisTool } from './tools/workload-analysis.js';

class GitHubCalendarServer {
  private server: Server;
  private teamStatusTool: TeamStatusTool;
  private personScheduleTool: PersonScheduleTool;
  private workloadAnalysisTool: WorkloadAnalysisTool;

  constructor() {
    this.server = new Server(
      {
        name: 'github-calendar-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Get GitHub token from environment or .env file
    let githubToken = process.env.GITHUB_TOKEN;
    
    // If not in environment, try to load from .env file
    if (!githubToken) {
      try {
        const fs = require('fs');
        const path = require('path');
        const { fileURLToPath } = require('url');
        
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const envPath = path.join(__dirname, '..', '.env');
        
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          const envLines = envContent.split('\n');
          
          for (const line of envLines) {
            const [key, value] = line.split('=');
            if (key?.trim() === 'GITHUB_TOKEN' && value?.trim() && value.trim() !== 'your_actual_github_token_here') {
              githubToken = value.trim();
              break;
            }
            // Also load GITHUB_OWNER and GITHUB_REPO
            if (key?.trim() === 'GITHUB_OWNER' && value?.trim()) {
              process.env.GITHUB_OWNER = value.trim();
            }
            if (key?.trim() === 'GITHUB_REPO' && value?.trim()) {
              process.env.GITHUB_REPO = value.trim();
            }
          }
        }
      } catch (error) {
        console.error('Error reading .env file:', error);
      }
    }
    
    if (!githubToken) {
      console.error('Available environment variables:', Object.keys(process.env).filter(k => k.includes('GITHUB')));
      console.error('Checked for .env file in project directory');
      throw new Error('GITHUB_TOKEN is required. Set it in environment or create .env file with GITHUB_TOKEN=your_token');
    }

    // Initialize tools
    this.teamStatusTool = new TeamStatusTool(githubToken);
    this.personScheduleTool = new PersonScheduleTool(githubToken);
    this.workloadAnalysisTool = new WorkloadAnalysisTool(githubToken);

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_team_status',
            description: 'Get current status of the development team including active issues, due items, and recent completions for each team member',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'get_person_schedule',
            description: 'Get the schedule and upcoming work for a specific team member',
            inputSchema: {
              type: 'object',
              properties: {
                login: {
                  type: 'string',
                  description: 'GitHub username of the team member',
                },
                days: {
                  type: 'number',
                  description: 'Number of days to look ahead (default: 7)',
                  default: 7,
                },
              },
              required: ['login'],
            },
          },
          {
            name: 'analyze_workload',
            description: 'Analyze team workload distribution and identify who can take on new tasks',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'find_best_assignee',
            description: 'Find the team member with the lightest workload for assigning new tasks',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_team_status': {
            const status = await this.teamStatusTool.getTeamStatus();
            return {
              content: [
                {
                  type: 'text',
                  text: this.formatTeamStatus(status),
                },
              ],
            };
          }

          case 'get_person_schedule': {
            const { login, days = 7 } = args as { login: string; days?: number };
            const schedule = await this.personScheduleTool.getPersonScheduleForDateRange(login, days);
            return {
              content: [
                {
                  type: 'text',
                  text: this.formatPersonSchedule(schedule, days),
                },
              ],
            };
          }

          case 'analyze_workload': {
            const analysis = await this.workloadAnalysisTool.analyzeWorkload();
            return {
              content: [
                {
                  type: 'text',
                  text: this.formatWorkloadAnalysis(analysis),
                },
              ],
            };
          }

          case 'find_best_assignee': {
            const bestAssignee = await this.workloadAnalysisTool.findBestAssignee();
            return {
              content: [
                {
                  type: 'text',
                  text: bestAssignee 
                    ? `Best assignee for new tasks: ${bestAssignee}`
                    : 'No suitable assignee found - all team members are at capacity',
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
      }
    });
  }

  private formatTeamStatus(status: any): string {
    const { members, totalActiveIssues, totalDueToday, lastUpdated } = status;
    
    let output = `## Team Status (as of ${new Date(lastUpdated).toLocaleString()})\n\n`;
    output += `**Overview:** ${totalActiveIssues} active issues, ${totalDueToday} due today\n\n`;
    
    if (members.length === 0) {
      output += 'No team members found with assigned issues.\n';
      return output;
    }

    output += '**Team Members:**\n';
    for (const member of members) {
      const { login, activeIssues, dueToday, completedThisWeek } = member;
      output += `- **${login}**: ${activeIssues} active`;
      
      if (dueToday > 0) {
        output += `, ${dueToday} due today`;
      }
      
      if (completedThisWeek > 0) {
        output += `, ${completedThisWeek} completed this week`;
      }
      
      output += '\n';
    }

    return output;
  }

  private formatPersonSchedule(schedule: any, days: number): string {
    const { login, upcomingIssues } = schedule;
    
    let output = `## ${login}'s Schedule (next ${days} days)\n\n`;
    
    if (upcomingIssues.length === 0) {
      output += 'No upcoming issues assigned.\n';
      return output;
    }

    output += '**Upcoming Work:**\n';
    for (const item of upcomingIssues) {
      const { issue, daysUntilDue } = item;
      output += `- **${issue.title}**`;
      
      if (daysUntilDue !== null) {
        if (daysUntilDue < 0) {
          output += ` (overdue by ${Math.abs(daysUntilDue)} days)`;
        } else if (daysUntilDue === 0) {
          output += ` (due today)`;
        } else {
          output += ` (due in ${daysUntilDue} days)`;
        }
      }
      
      output += `\n  - Issue #${issue.number}: ${issue.html_url}\n`;
    }

    return output;
  }

  private formatWorkloadAnalysis(analysis: any): string {
    const { members, leastBusy, mostBusy } = analysis;
    
    let output = '## Workload Analysis\n\n';
    
    output += '**Team Workload Distribution:**\n';
    for (const member of members) {
      const { login, activeIssues, workloadLevel, recommendation } = member;
      const levelEmojiMap: Record<string, string> = {
        light: '🟢',
        moderate: '🟡', 
        heavy: '🟠',
        overloaded: '🔴'
      };
      const levelEmoji = levelEmojiMap[workloadLevel] || '⚪';
      
      output += `- ${levelEmoji} **${login}**: ${activeIssues} issues (${workloadLevel}) - ${recommendation}\n`;
    }

    if (leastBusy.length > 0) {
      output += `\n**Available for new work:** ${leastBusy.join(', ')}\n`;
    }

    if (mostBusy.length > 0) {
      output += `\n**At capacity:** ${mostBusy.join(', ')}\n`;
    }

    return output;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GitHub Calendar MCP server running on stdio');
  }
}

// Start the server
const server = new GitHubCalendarServer();
server.run().catch((error) => {
  console.error('Failed to run server:', error);
  process.exit(1);
});
