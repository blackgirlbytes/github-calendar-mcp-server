#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Octokit } from '@octokit/rest';
import { format, addDays, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns';
import { createUIResource } from '@mcp-ui/server';

// GitHub configuration
const DEFAULT_ORG = 'squareup';
const DEFAULT_PROJECT_NUMBER = 333;
const DEFAULT_LABEL = 'area: devrel-opensource';

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

    // Initialize GitHub API client
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    this.setupToolHandlers();
  }

  // GitHub GraphQL query for Projects v2
  getProjectV2Query() {
    return `
      query($org: String!, $projectNumber: Int!, $cursor: String) {
        organization(login: $org) {
          projectV2(number: $projectNumber) {
            id
            title
            items(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                type
                content {
                  ... on Issue {
                    id
                    number
                    title
                    body
                    state
                    createdAt
                    updatedAt
                    closedAt
                    url
                    author {
                      login
                      avatarUrl
                    }
                    labels(first: 20) {
                      nodes {
                        id
                        name
                        color
                        description
                      }
                    }
                    assignees(first: 10) {
                      nodes {
                        login
                        avatarUrl
                      }
                    }
                    milestone {
                      title
                      description
                      dueOn
                    }
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldDateValue {
                      field {
                        ... on ProjectV2FieldCommon {
                          id
                          name
                        }
                      }
                      date
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      field {
                        ... on ProjectV2FieldCommon {
                          id
                          name
                        }
                      }
                      text
                    }
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field {
                        ... on ProjectV2FieldCommon {
                          id
                          name
                        }
                      }
                      name
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      field {
                        ... on ProjectV2FieldCommon {
                          id
                          name
                        }
                      }
                      number
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

  async fetchProjectItems(org = DEFAULT_ORG, projectNumber = DEFAULT_PROJECT_NUMBER, sinceDate) {
    const since = sinceDate || new Date('2025-08-01');

    try {
      console.error('Attempting to use GraphQL API for Projects v2...');
      return await this.fetchProjectItemsGraphQL(org, projectNumber, since);
    } catch (graphqlError) {
      console.error('GraphQL API failed, falling back to Search API:', graphqlError);
      return await this.fetchIssuesByLabel(org, since);
    }
  }

  async fetchProjectItemsGraphQL(org, projectNumber, since) {
    const allItems = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await this.octokit.graphql(this.getProjectV2Query(), {
        org,
        projectNumber,
        cursor,
      });

      const project = response.organization.projectV2;
      if (!project) {
        throw new Error(`Project ${projectNumber} not found for organization ${org}`);
      }

      const items = project.items.nodes;

      // Filter items based on date and label
      const filteredItems = items.filter((item) => {
        if (!item.content || item.type !== 'ISSUE') return false;
        
        // Check if issue has the required label
        const hasRequiredLabel = item.content.labels?.nodes?.some(
          (label) => label.name === DEFAULT_LABEL
        );
        
        if (!hasRequiredLabel) return false;

        // Check if issue was created after our since date
        const createdAt = new Date(item.content.createdAt);
        return createdAt >= since;
      });

      // Transform GraphQL response to our format
      const transformedItems = filteredItems.map((item) => ({
        id: item.id,
        content: {
          id: item.content.id,
          number: item.content.number,
          title: item.content.title,
          body: item.content.body || '',
          state: item.content.state.toLowerCase(),
          created_at: item.content.createdAt,
          updated_at: item.content.updatedAt,
          closed_at: item.content.closedAt,
          html_url: item.content.url,
          user: {
            login: item.content.author?.login || '',
            avatar_url: item.content.author?.avatarUrl || '',
          },
          labels: item.content.labels?.nodes?.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
            description: label.description,
          })) || [],
          assignees: item.content.assignees?.nodes?.map((assignee) => ({
            login: assignee.login,
            avatar_url: assignee.avatarUrl,
          })) || [],
          milestone: item.content.milestone ? {
            title: item.content.milestone.title,
            description: item.content.milestone.description,
            due_on: item.content.milestone.dueOn,
          } : null,
        },
        fieldValues: {
          nodes: item.fieldValues.nodes.map((fieldValue) => ({
            field: {
              name: fieldValue.field?.name || '',
            },
            date: fieldValue.date || null,
            text: fieldValue.text || null,
            name: fieldValue.name || null,
            number: fieldValue.number || null,
          })),
        },
      }));

      allItems.push(...transformedItems);

      hasNextPage = project.items.pageInfo.hasNextPage;
      cursor = project.items.pageInfo.endCursor;
    }

    console.error(`Successfully fetched ${allItems.length} items using GraphQL API`);
    return allItems;
  }

  // Fallback function to search issues by label directly
  async fetchIssuesByLabel(org, since) {
    const allItems = [];
    let page = 1;
    const perPage = 100;
    let hasNextPage = true;

    while (hasNextPage) {
      try {
        // Search for issues with the specific label in the organization
        const { data: searchResult } = await this.octokit.rest.search.issuesAndPullRequests({
          q: `org:${org} label:"${DEFAULT_LABEL}" type:issue created:>=${since.toISOString().split('T')[0]}`,
          per_page: perPage,
          page: page,
        });

        if (searchResult.items.length === 0) {
          hasNextPage = false;
          break;
        }

        for (const issue of searchResult.items) {
          const projectItem = {
            id: issue.id.toString(),
            content: {
              id: issue.id,
              number: issue.number,
              title: issue.title,
              body: issue.body || '',
              state: issue.state,
              created_at: issue.created_at,
              updated_at: issue.updated_at,
              closed_at: issue.closed_at,
              html_url: issue.html_url,
              user: {
                login: issue.user?.login || '',
                avatar_url: issue.user?.avatar_url || '',
              },
              labels: issue.labels.map((label) => ({
                id: label.id,
                name: label.name,
                color: label.color,
                description: label.description,
              })),
              assignees: issue.assignees?.map((assignee) => ({
                login: assignee.login,
                avatar_url: assignee.avatar_url,
              })) || [],
              milestone: issue.milestone ? {
                title: issue.milestone.title,
                description: issue.milestone.description,
                due_on: issue.milestone.due_on,
              } : null,
            },
            fieldValues: {
              nodes: [],
            },
          };

          allItems.push(projectItem);
        }

        page++;
        hasNextPage = searchResult.items.length === perPage;
      } catch (searchError) {
        console.error('Error searching issues:', searchError);
        break;
      }
    }

    return allItems;
  }

  transformToCalendarEvents(items) {
    return items.map((item) => {
      const issue = item.content;
      
      // Extract start and end dates from field values
      let startDate = null;
      let endDate = null;
      let projectStatus = undefined;
      
      item.fieldValues.nodes.forEach((fieldValue) => {
        const fieldName = fieldValue.field.name.toLowerCase();
        
        if (fieldName.includes('start') && fieldValue.date) {
          startDate = new Date(fieldValue.date);
        } else if ((fieldName.includes('end') || fieldName.includes('due')) && fieldValue.date) {
          endDate = new Date(fieldValue.date);
        } else if ((fieldName.includes('status') || fieldName.includes('state') || fieldName.includes('progress')) && fieldValue.name) {
          projectStatus = fieldValue.name;
        }
      });

      // Try to extract dates from issue body if not found in field values
      if (!startDate || !endDate) {
        const body = issue.body || '';
        
        // Look for date patterns in the issue body
        const startDateMatch = body.match(/\*\*Start Date:\*\*.*?\(([^)]+)\)/);
        const endDateMatch = body.match(/\*\*End Date:\*\*.*?\(([^)]+)\)/);
        
        if (startDateMatch && !startDate) {
          startDate = new Date(startDateMatch[1]);
        }
        
        if (endDateMatch && !endDate) {
          endDate = new Date(endDateMatch[1]);
        }
      }

      // If no start date from fields or body, use created date
      if (!startDate) {
        startDate = new Date(issue.created_at);
      }

      // If issue has a milestone with due date, use that as end date
      if (!endDate && issue.milestone?.due_on) {
        endDate = new Date(issue.milestone.due_on);
      }

      return {
        id: `${issue.number}`,
        title: issue.title,
        startDate,
        endDate,
        url: issue.html_url,
        labels: issue.labels.map((label) => ({
          name: label.name,
          color: `#${label.color}`,
        })),
        assignees: issue.assignees.map((assignee) => ({
          login: assignee.login,
          avatar_url: assignee.avatar_url,
        })),
        status: issue.state,
        projectStatus,
        type: 'issue',
      };
    }).filter((event) => event.startDate); // Only include events with start dates
  }

  async getCalendarEvents(org = DEFAULT_ORG, projectNumber = DEFAULT_PROJECT_NUMBER, sinceDate) {
    const items = await this.fetchProjectItems(org, projectNumber, sinceDate);
    return this.transformToCalendarEvents(items);
  }

  // Analyze team workload
  analyzeTeamWorkload(events) {
    const teamWorkload = {};
    const now = new Date();
    
    events.forEach(event => {
      if (event.status === 'closed') return; // Skip completed tasks
      
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
        
        // Check if overdue
        if (event.endDate && event.endDate < now) {
          member.overdueIssues++;
        }
        
        // Check if upcoming (starts in future)
        if (event.startDate > now) {
          member.upcomingIssues++;
        }
      });
    });
    
    return Object.values(teamWorkload).sort((a, b) => a.totalWorkload - b.totalWorkload);
  }

  // Create calendar UI for events
  createCalendarUI(events, currentDate = new Date()) {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    // Group events by date
    const eventsByDate = {};
    events.forEach(event => {
      const eventDates = [];
      
      if (event.endDate && event.startDate.getTime() !== event.endDate.getTime()) {
        // Multi-day event - add to all days in range
        const eventStart = event.startDate > monthStart ? event.startDate : monthStart;
        const eventEnd = event.endDate < monthEnd ? event.endDate : monthEnd;
        
        if (eventStart <= monthEnd && eventEnd >= monthStart) {
          const eventInterval = eachDayOfInterval({ start: eventStart, end: eventEnd });
          eventDates.push(...eventInterval);
        }
      } else {
        // Single day event
        if (isSameMonth(event.startDate, currentDate)) {
          eventDates.push(event.startDate);
        }
      }
      
      eventDates.forEach(date => {
        const dateKey = format(date, 'yyyy-MM-dd');
        if (!eventsByDate[dateKey]) {
          eventsByDate[dateKey] = [];
        }
        eventsByDate[dateKey].push(event);
      });
    });

    // Color palette for assignees
    const assigneeColors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
    ];
    
    const uniqueAssignees = Array.from(
      new Set(events.flatMap(event => event.assignees.map(a => a.login)))
    );
    
    const assigneeColorMap = {};
    uniqueAssignees.forEach((login, index) => {
      assigneeColorMap[login] = assigneeColors[index % assigneeColors.length];
    });

    // Generate calendar grid
    const calendarGrid = calendarDays.map(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const dayEvents = eventsByDate[dateKey] || [];
      const isToday = isSameDay(day, new Date());
      
      const eventItems = dayEvents.slice(0, 3).map(event => {
        const primaryAssignee = event.assignees[0];
        const color = primaryAssignee ? assigneeColorMap[primaryAssignee.login] : '#6b7280';
        const isCompleted = event.status === 'closed';
        
        return `
          <div class="event" style="background-color: ${color}${isCompleted ? '80' : ''}; color: white; font-size: 10px; padding: 2px 4px; margin: 1px 0; border-radius: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;" title="${event.title}">
            ${isCompleted ? '✓ ' : ''}${event.title}
          </div>
        `;
      }).join('');
      
      const moreCount = dayEvents.length > 3 ? dayEvents.length - 3 : 0;
      const moreIndicator = moreCount > 0 ? `<div class="more" style="font-size: 9px; color: #666;">+${moreCount} more</div>` : '';
      
      return `
        <div class="calendar-day ${isToday ? 'today' : ''}" style="border: 1px solid #e5e7eb; padding: 4px; min-height: 100px; background: ${isToday ? '#eff6ff' : 'white'};">
          <div class="day-number" style="font-weight: ${isToday ? 'bold' : 'normal'}; color: ${isToday ? '#3b82f6' : '#374151'}; margin-bottom: 4px;">
            ${format(day, 'd')}
          </div>
          <div class="events">
            ${eventItems}
            ${moreIndicator}
          </div>
        </div>
      `;
    }).join('');

    // Generate assignee legend
    const assigneeLegend = uniqueAssignees.map(login => {
      const color = assigneeColorMap[login];
      const assignee = events.find(e => e.assignees.some(a => a.login === login))?.assignees.find(a => a.login === login);
      
      return `
        <div onclick="filterByAssignee('${login}')" style="display: flex; align-items: center; margin: 4px 8px; cursor: pointer; padding: 4px; border-radius: 4px; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#f3f4f6'" onmouseout="this.style.backgroundColor='transparent'">
          <div style="width: 12px; height: 12px; background-color: ${color}; border-radius: 2px; margin-right: 8px;"></div>
          <img src="${assignee?.avatar_url || ''}" alt="${login}" style="width: 20px; height: 20px; border-radius: 50%; margin-right: 8px;">
          <span style="font-size: 12px;">${login}</span>
        </div>
      `;
    }).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
        .container { max-width: 1000px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
        .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .calendar-header { display: grid; grid-template-columns: repeat(7, 1fr); background: #f8fafc; }
        .calendar-header-day { padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; }
        .calendar-day { border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
        .calendar-day:nth-child(7n) { border-right: none; }
        .today { background-color: #eff6ff !important; }
        .legend { padding: 16px; background: #f8fafc; border-top: 1px solid #e5e7eb; }
        .legend-title { font-weight: 600; margin-bottom: 12px; color: #374151; }
        .legend-items { display: flex; flex-wrap: wrap; }
        .stats { padding: 16px; background: #f8fafc; display: flex; justify-content: space-around; text-align: center; }
        .stat { }
        .stat-number { font-size: 24px; font-weight: bold; color: #3b82f6; }
        .stat-label { font-size: 12px; color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin: 0; font-size: 24px;">📅 GitHub Project Calendar</h2>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">${format(currentDate, 'MMMM yyyy')} • DevRel Open Source</p>
        </div>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-number">${events.length}</div>
            <div class="stat-label">Total Events</div>
          </div>
          <div class="stat">
            <div class="stat-number">${events.filter(e => e.status === 'open').length}</div>
            <div class="stat-label">Open Issues</div>
          </div>
          <div class="stat">
            <div class="stat-number">${events.filter(e => e.status === 'closed').length}</div>
            <div class="stat-label">Completed</div>
          </div>
          <div class="stat">
            <div class="stat-number">${uniqueAssignees.length}</div>
            <div class="stat-label">Team Members</div>
          </div>
        </div>

        <div class="calendar-header">
          <div class="calendar-header-day">Sun</div>
          <div class="calendar-header-day">Mon</div>
          <div class="calendar-header-day">Tue</div>
          <div class="calendar-header-day">Wed</div>
          <div class="calendar-header-day">Thu</div>
          <div class="calendar-header-day">Fri</div>
          <div class="calendar-header-day">Sat</div>
        </div>

        <div class="calendar-grid">
          ${calendarGrid}
        </div>

        ${uniqueAssignees.length > 0 ? `
          <div class="legend">
            <div class="legend-title">Team Members</div>
            <div class="legend-items">
              ${assigneeLegend}
            </div>
          </div>
        ` : ''}

        <div style="padding: 16px; background: #f8fafc; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; flex-wrap: wrap;">
          <button onclick="refreshCalendar()" style="background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">🔄 Refresh</button>
          <button onclick="showTeamStatus()" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">👥 Team Status</button>
          <button onclick="analyzeWorkload()" style="background: #f59e0b; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">📊 Analyze Workload</button>
          <button onclick="findAssignee()" style="background: #8b5cf6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">🎯 Find Assignee</button>
        </div>
      </div>

      <script>
        // Auto-resize the iframe to fit content
        new ResizeObserver(entries => {
          entries.forEach(entry => {
            window.parent.postMessage({
              type: "ui-size-change",
              payload: { height: entry.contentRect.height + 50 }
            }, "*");
          });
        }).observe(document.documentElement);

        // Interactive functions
        function refreshCalendar() {
          window.parent.postMessage({
            type: "prompt",
            payload: { prompt: "Refresh the calendar and show me updated events" }
          }, "*");
        }

        function showTeamStatus() {
          window.parent.postMessage({
            type: "prompt",
            payload: { prompt: "Show me the current team status" }
          }, "*");
        }

        function analyzeWorkload() {
          window.parent.postMessage({
            type: "prompt",
            payload: { prompt: "Analyze the team workload distribution" }
          }, "*");
        }

        function findAssignee() {
          window.parent.postMessage({
            type: "prompt",
            payload: { prompt: "Who should I assign a new task to?" }
          }, "*");
        }

        function filterByAssignee(login) {
          window.parent.postMessage({
            type: "prompt",
            payload: { prompt: \`Show me calendar events for \${login}\` }
          }, "*");
        }

        function viewEventDetails(eventUrl) {
          window.parent.postMessage({
            type: "link",
            payload: { url: eventUrl }
          }, "*");
        }
      </script>
    </body>
    </html>
    `;
  }

  // Create person schedule UI
  createPersonScheduleUI(personEvents, login, days) {
    if (personEvents.length === 0) {
      return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
          .empty-state { padding: 40px; text-align: center; color: #6b7280; }
          .empty-icon { font-size: 48px; margin-bottom: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0; font-size: 24px;">📅 Schedule for ${login}</h2>
            <p style="margin: 8px 0 0 0; opacity: 0.9;">Next ${days} days</p>
          </div>
          
          <div class="empty-state">
            <div class="empty-icon">🏖️</div>
            <h3 style="margin: 0 0 8px 0; color: #374151;">No upcoming work!</h3>
            <p style="margin: 0;">${login} has a clear schedule for the next ${days} days.</p>
          </div>
        </div>

        <script>
          new ResizeObserver(entries => {
            entries.forEach(entry => {
              window.parent.postMessage({
                type: "ui-size-change",
                payload: { height: entry.contentRect.height + 50 }
              }, "*");
            });
          }).observe(document.documentElement);
        </script>
      </body>
      </html>
      `;
    }

    const eventCards = personEvents.map(event => {
      const startStr = format(event.startDate, 'MMM dd, yyyy');
      const endStr = event.endDate ? format(event.endDate, 'MMM dd, yyyy') : 'No end date';
      const statusColor = event.status === 'open' ? '#10b981' : '#6b7280';
      const isOverdue = event.endDate && event.endDate < new Date();
      const urgencyColor = isOverdue ? '#ef4444' : '#3b82f6';
      
      return `
        <div class="event-card" style="background: white; border-radius: 8px; padding: 16px; margin: 12px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid ${urgencyColor};">
          <div style="display: flex; justify-content: between; align-items: start; margin-bottom: 12px;">
            <h3 style="margin: 0; color: #1f2937; font-size: 16px; flex: 1;">${event.title}</h3>
            <span style="background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-left: 12px;">${event.status}</span>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px;">
            <div>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Start Date</div>
              <div style="font-weight: 500; color: #374151;">${startStr}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">End Date</div>
              <div style="font-weight: 500; color: ${isOverdue ? '#ef4444' : '#374151'};">${endStr}</div>
            </div>
          </div>
          
          ${event.assignees.length > 1 ? `
            <div style="margin-bottom: 12px;">
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Collaborators</div>
              <div style="display: flex; gap: 4px;">
                ${event.assignees.slice(1).map(assignee => `
                  <img src="${assignee.avatar_url}" alt="${assignee.login}" style="width: 24px; height: 24px; border-radius: 50%;" title="${assignee.login}">
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          <div style="display: flex; justify-content: space-between; align-items: center;">
            ${isOverdue ? '<span style="color: #ef4444; font-size: 12px; font-weight: 500;">⚠️ Overdue</span>' : '<span></span>'}
            <a href="${event.url}" target="_blank" style="color: #3b82f6; text-decoration: none; font-size: 12px; font-weight: 500;">View Issue →</a>
          </div>
        </div>
      `;
    }).join('');

    const stats = {
      total: personEvents.length,
      open: personEvents.filter(e => e.status === 'open').length,
      overdue: personEvents.filter(e => e.endDate && e.endDate < new Date()).length
    };

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
        .container { max-width: 700px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 12px 12px 0 0; }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; background: white; }
        .stat { text-align: center; padding: 12px; }
        .stat-number { font-size: 24px; font-weight: bold; color: #3b82f6; }
        .stat-label { font-size: 12px; color: #6b7280; }
        .events { background: #f8fafc; padding: 16px; border-radius: 0 0 12px 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin: 0; font-size: 24px;">📅 Schedule for ${login}</h2>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">Next ${days} days</p>
        </div>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-number">${stats.total}</div>
            <div class="stat-label">Total Items</div>
          </div>
          <div class="stat">
            <div class="stat-number" style="color: #10b981;">${stats.open}</div>
            <div class="stat-label">Active</div>
          </div>
          <div class="stat">
            <div class="stat-number" style="color: ${stats.overdue > 0 ? '#ef4444' : '#6b7280'};">${stats.overdue}</div>
            <div class="stat-label">Overdue</div>
          </div>
        </div>

        <div class="events">
          ${eventCards}
        </div>
      </div>

      <script>
        new ResizeObserver(entries => {
          entries.forEach(entry => {
            window.parent.postMessage({
              type: "ui-size-change",
              payload: { height: entry.contentRect.height + 50 }
            }, "*");
          });
        }).observe(document.documentElement);
      </script>
    </body>
    </html>
    `;
  }

  // Create workload analysis UI
  createWorkloadAnalysisUI(workloadAnalysis) {
    const maxWorkload = Math.max(...workloadAnalysis.map(m => m.totalWorkload), 1);
    
    const analysisCards = workloadAnalysis.map((member, index) => {
      const workloadLevel = member.totalWorkload <= 2 ? 'Light' : 
                           member.totalWorkload <= 4 ? 'Moderate' : 'Heavy';
      const levelColor = member.totalWorkload <= 2 ? '#10b981' : 
                        member.totalWorkload <= 4 ? '#f59e0b' : '#ef4444';
      const workloadPercentage = (member.totalWorkload / maxWorkload) * 100;
      
      return `
        <div class="analysis-card" style="background: white; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin: 8px 0;">
          <div style="display: flex; align-items: center; margin-bottom: 16px;">
            <div style="background: ${levelColor}; color: white; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px;">
              ${index + 1}
            </div>
            <img src="${member.avatar_url}" alt="${member.login}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 12px;">
            <div style="flex: 1;">
              <h3 style="margin: 0; font-size: 16px; color: #1f2937;">${member.login}</h3>
              <span style="background: ${levelColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">${workloadLevel}</span>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 24px; font-weight: bold; color: ${levelColor};">${member.totalWorkload}</div>
              <div style="font-size: 12px; color: #6b7280;">issues</div>
            </div>
          </div>
          
          <div style="margin-bottom: 12px;">
            <div style="background: #f3f4f6; border-radius: 8px; height: 8px; overflow: hidden;">
              <div style="background: ${levelColor}; height: 100%; width: ${workloadPercentage}%; transition: width 0.3s ease;"></div>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center;">
            <div>
              <div style="font-size: 16px; font-weight: bold; color: #3b82f6;">${member.activeIssues}</div>
              <div style="font-size: 11px; color: #6b7280;">Active</div>
            </div>
            <div>
              <div style="font-size: 16px; font-weight: bold; color: #10b981;">${member.upcomingIssues}</div>
              <div style="font-size: 11px; color: #6b7280;">Upcoming</div>
            </div>
            <div>
              <div style="font-size: 16px; font-weight: bold; color: ${member.overdueIssues > 0 ? '#ef4444' : '#6b7280'};">${member.overdueIssues}</div>
              <div style="font-size: 11px; color: #6b7280;">Overdue</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const totalIssues = workloadAnalysis.reduce((sum, m) => sum + m.totalWorkload, 0);
    const avgWorkload = workloadAnalysis.length > 0 ? (totalIssues / workloadAnalysis.length).toFixed(1) : 0;
    const overloadedMembers = workloadAnalysis.filter(m => m.totalWorkload > 4).length;

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 12px; margin-bottom: 20px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
        .summary-card { background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
        .summary-number { font-size: 32px; font-weight: bold; color: #3b82f6; }
        .summary-label { font-size: 14px; color: #6b7280; margin-top: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin: 0; font-size: 24px;">📊 Team Workload Analysis</h2>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">Current capacity and distribution</p>
        </div>
        
        <div class="summary">
          <div class="summary-card">
            <div class="summary-number">${workloadAnalysis.length}</div>
            <div class="summary-label">Team Members</div>
          </div>
          <div class="summary-card">
            <div class="summary-number">${totalIssues}</div>
            <div class="summary-label">Total Issues</div>
          </div>
          <div class="summary-card">
            <div class="summary-number">${avgWorkload}</div>
            <div class="summary-label">Avg per Person</div>
          </div>
          <div class="summary-card">
            <div class="summary-number" style="color: ${overloadedMembers > 0 ? '#ef4444' : '#10b981'};">${overloadedMembers}</div>
            <div class="summary-label">Overloaded</div>
          </div>
        </div>

        <div class="analysis-list">
          ${analysisCards}
        </div>
      </div>

      <script>
        new ResizeObserver(entries => {
          entries.forEach(entry => {
            window.parent.postMessage({
              type: "ui-size-change",
              payload: { height: entry.contentRect.height + 50 }
            }, "*");
          });
        }).observe(document.documentElement);
      </script>
    </body>
    </html>
    `;
  }

  // Create best assignee recommendation UI
  createBestAssigneeUI(bestAssignee, allMembers) {
    const recommendationCard = `
      <div class="recommendation-card" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🎯</div>
        <h2 style="margin: 0 0 8px 0; font-size: 24px;">Recommended Assignee</h2>
        <div style="display: flex; align-items: center; justify-content: center; margin: 16px 0;">
          <img src="${bestAssignee.avatar_url}" alt="${bestAssignee.login}" style="width: 60px; height: 60px; border-radius: 50%; margin-right: 16px; border: 3px solid rgba(255,255,255,0.3);">
          <div>
            <h3 style="margin: 0; font-size: 20px;">${bestAssignee.login}</h3>
            <p style="margin: 4px 0 0 0; opacity: 0.9;">Lightest workload</p>
          </div>
        </div>
      </div>
    `;

    const workloadComparison = allMembers.slice(0, 5).map((member, index) => {
      const isRecommended = member.login === bestAssignee.login;
      const workloadLevel = member.totalWorkload <= 2 ? 'Light' : 
                           member.totalWorkload <= 4 ? 'Moderate' : 'Heavy';
      const levelColor = member.totalWorkload <= 2 ? '#10b981' : 
                        member.totalWorkload <= 4 ? '#f59e0b' : '#ef4444';
      
      return `
        <div class="comparison-card" style="background: ${isRecommended ? '#f0fdf4' : 'white'}; border: 2px solid ${isRecommended ? '#10b981' : '#e5e7eb'}; border-radius: 8px; padding: 16px; margin: 8px 0;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            ${isRecommended ? '<div style="background: #10b981; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px;">✓</div>' : `<div style="background: #f3f4f6; color: #6b7280; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px;">${index + 1}</div>`}
            <img src="${member.avatar_url}" alt="${member.login}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 12px;">
            <div style="flex: 1;">
              <h4 style="margin: 0; color: #1f2937;">${member.login}</h4>
              <span style="background: ${levelColor}; color: white; padding: 1px 6px; border-radius: 8px; font-size: 11px;">${workloadLevel}</span>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 18px; font-weight: bold; color: ${levelColor};">${member.totalWorkload}</div>
              <div style="font-size: 10px; color: #6b7280;">issues</div>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px; text-align: center;">
            <div>
              <span style="font-weight: bold; color: #3b82f6;">${member.activeIssues}</span>
              <span style="color: #6b7280;"> active</span>
            </div>
            <div>
              <span style="font-weight: bold; color: #10b981;">${member.upcomingIssues}</span>
              <span style="color: #6b7280;"> upcoming</span>
            </div>
            <div>
              <span style="font-weight: bold; color: ${member.overdueIssues > 0 ? '#ef4444' : '#6b7280'};">${member.overdueIssues}</span>
              <span style="color: #6b7280;"> overdue</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; }
      </style>
    </head>
    <body>
      <div class="container">
        ${recommendationCard}
        
        <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <h3 style="margin: 0 0 16px 0; color: #1f2937;">Team Workload Comparison</h3>
          ${workloadComparison}
        </div>
      </div>

      <script>
        new ResizeObserver(entries => {
          entries.forEach(entry => {
            window.parent.postMessage({
              type: "ui-size-change",
              payload: { height: entry.contentRect.height + 50 }
            }, "*");
          });
        }).observe(document.documentElement);
      </script>
    </body>
    </html>
    `;
  }

  // Create team status dashboard UI
  createTeamStatusUI(workloadAnalysis) {
    const teamCards = workloadAnalysis.map(member => {
      const workloadLevel = member.totalWorkload <= 2 ? 'Light' : 
                           member.totalWorkload <= 4 ? 'Moderate' : 'Heavy';
      const levelColor = member.totalWorkload <= 2 ? '#10b981' : 
                        member.totalWorkload <= 4 ? '#f59e0b' : '#ef4444';
      
      return `
        <div class="team-card" style="background: white; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin: 8px;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <img src="${member.avatar_url}" alt="${member.login}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 12px;">
            <div>
              <h3 style="margin: 0; font-size: 16px; color: #1f2937;">${member.login}</h3>
              <span style="background: ${levelColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">${workloadLevel}</span>
            </div>
          </div>
          
          <div class="workload-stats" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            <div class="stat">
              <div style="font-size: 20px; font-weight: bold; color: #3b82f6;">${member.activeIssues}</div>
              <div style="font-size: 12px; color: #6b7280;">Active</div>
            </div>
            <div class="stat">
              <div style="font-size: 20px; font-weight: bold; color: #10b981;">${member.upcomingIssues}</div>
              <div style="font-size: 12px; color: #6b7280;">Upcoming</div>
            </div>
            <div class="stat">
              <div style="font-size: 20px; font-weight: bold; color: ${member.overdueIssues > 0 ? '#ef4444' : '#6b7280'};">${member.overdueIssues}</div>
              <div style="font-size: 12px; color: #6b7280;">Overdue</div>
            </div>
            <div class="stat">
              <div style="font-size: 20px; font-weight: bold; color: #8b5cf6;">${member.totalWorkload}</div>
              <div style="font-size: 12px; color: #6b7280;">Total</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 24px; }
        .team-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="color: #1f2937; margin: 0;">👥 Team Status Dashboard</h2>
          <p style="color: #6b7280; margin: 8px 0 0 0;">Current workload distribution across team members</p>
        </div>
        
        <div class="team-grid">
          ${teamCards}
        </div>
      </div>

      <script>
        // Auto-resize the iframe to fit content
        new ResizeObserver(entries => {
          entries.forEach(entry => {
            window.parent.postMessage({
              type: "ui-size-change",
              payload: { height: entry.contentRect.height + 50 }
            }, "*");
          });
        }).observe(document.documentElement);
      </script>
    </body>
    </html>
    `;
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_team_status',
            description: 'Get current status of the development team including active issues, due items, and recent completions for each team member',
            inputSchema: {
              type: 'object',
              properties: {},
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
            },
          },
          {
            name: 'find_best_assignee',
            description: 'Find the team member with the lightest workload for assigning new tasks',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_calendar_events',
            description: 'Get GitHub project calendar events with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                org: {
                  type: 'string',
                  description: 'GitHub organization name (default: squareup)',
                  default: DEFAULT_ORG,
                },
                project: {
                  type: 'number',
                  description: 'GitHub project number (default: 333)',
                  default: DEFAULT_PROJECT_NUMBER,
                },
                since: {
                  type: 'string',
                  description: 'ISO date string to filter events from (default: 2025-08-01)',
                },
                assignee: {
                  type: 'string',
                  description: 'Filter events by assignee GitHub username',
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_team_status': {
            const events = await this.getCalendarEvents();
            const workloadAnalysis = this.analyzeTeamWorkload(events);
            
            const statusReport = workloadAnalysis.map(member => {
              return `**${member.login}**\n` +
                     `- Active Issues: ${member.activeIssues}\n` +
                     `- Upcoming Issues: ${member.upcomingIssues}\n` +
                     `- Overdue Issues: ${member.overdueIssues}\n` +
                     `- Total Workload: ${member.totalWorkload}`;
            }).join('\n\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `# Team Status Report\n\n${statusReport || 'No team members found with active work.'}`,
                },
                createUIResource({
                  uri: `ui://team-status/${Date.now()}`,
                  content: { type: 'rawHtml', htmlString: this.createTeamStatusUI(workloadAnalysis) },
                  encoding: 'text'
                })
              ],
            };
          }

          case 'get_person_schedule': {
            const { login, days = 7 } = args;
            const events = await this.getCalendarEvents();
            const endDate = addDays(new Date(), days);
            
            const personEvents = events.filter(event => 
              event.assignees.some(assignee => assignee.login === login) &&
              event.startDate <= endDate
            ).sort((a, b) => a.startDate - b.startDate);

            const scheduleText = personEvents.length > 0 ? 
              personEvents.map(event => {
                const startStr = format(event.startDate, 'MMM dd, yyyy');
                const endStr = event.endDate ? format(event.endDate, 'MMM dd, yyyy') : 'No end date';
                return `**${event.title}** (${event.status})\n` +
                       `- Start: ${startStr}\n` +
                       `- End: ${endStr}\n` +
                       `- URL: ${event.url}`;
              }).join('\n\n') :
              `No upcoming work found for ${login} in the next ${days} days.`;

            return {
              content: [
                {
                  type: 'text',
                  text: `# Schedule for ${login} (Next ${days} days)\n\n${scheduleText}`,
                },
                createUIResource({
                  uri: `ui://person-schedule/${login}/${Date.now()}`,
                  content: { type: 'rawHtml', htmlString: this.createPersonScheduleUI(personEvents, login, days) },
                  encoding: 'text'
                })
              ],
            };
          }

          case 'analyze_workload': {
            const events = await this.getCalendarEvents();
            const workloadAnalysis = this.analyzeTeamWorkload(events);
            
            const analysisText = workloadAnalysis.map((member, index) => {
              const workloadLevel = member.totalWorkload <= 2 ? 'Light' : 
                                   member.totalWorkload <= 4 ? 'Moderate' : 'Heavy';
              return `${index + 1}. **${member.login}** - ${workloadLevel} (${member.totalWorkload} issues)\n` +
                     `   - Active: ${member.activeIssues}, Upcoming: ${member.upcomingIssues}, Overdue: ${member.overdueIssues}`;
            }).join('\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `# Team Workload Analysis\n\n${analysisText || 'No team workload data available.'}`,
                },
                createUIResource({
                  uri: `ui://workload-analysis/${Date.now()}`,
                  content: { type: 'rawHtml', htmlString: this.createWorkloadAnalysisUI(workloadAnalysis) },
                  encoding: 'text'
                })
              ],
            };
          }

          case 'find_best_assignee': {
            const events = await this.getCalendarEvents();
            const workloadAnalysis = this.analyzeTeamWorkload(events);
            
            if (workloadAnalysis.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No team members found in the current project.',
                  },
                ],
              };
            }

            const bestAssignee = workloadAnalysis[0]; // Already sorted by workload
            
            return {
              content: [
                {
                  type: 'text',
                  text: `# Best Assignee Recommendation\n\n` +
                        `**${bestAssignee.login}** has the lightest workload:\n` +
                        `- Current workload: ${bestAssignee.totalWorkload} issues\n` +
                        `- Active: ${bestAssignee.activeIssues}\n` +
                        `- Upcoming: ${bestAssignee.upcomingIssues}\n` +
                        `- Overdue: ${bestAssignee.overdueIssues}`,
                },
                createUIResource({
                  uri: `ui://best-assignee/${Date.now()}`,
                  content: { type: 'rawHtml', htmlString: this.createBestAssigneeUI(bestAssignee, workloadAnalysis) },
                  encoding: 'text'
                })
              ],
            };
          }

          case 'get_calendar_events': {
            const { org = DEFAULT_ORG, project = DEFAULT_PROJECT_NUMBER, since, assignee } = args;
            
            let sinceDate;
            if (since) {
              sinceDate = parseISO(since);
            }
            
            let events = await this.getCalendarEvents(org, project, sinceDate);
            
            // Filter by assignee if specified
            if (assignee) {
              events = events.filter(event => 
                event.assignees.some(a => a.login === assignee)
              );
            }

            if (events.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No calendar events found matching the criteria.',
                  },
                  createUIResource({
                    uri: `ui://calendar-empty/${Date.now()}`,
                    content: { type: 'rawHtml', htmlString: this.createCalendarUI([]) },
                    encoding: 'text'
                  })
                ],
              };
            }

            const eventsText = events.map(event => {
              const startStr = format(event.startDate, 'MMM dd, yyyy');
              const endStr = event.endDate ? format(event.endDate, 'MMM dd, yyyy') : 'No end date';
              const assigneeList = event.assignees.map(a => a.login).join(', ') || 'Unassigned';
              
              return `**${event.title}** (${event.status})\n` +
                     `- Assignees: ${assigneeList}\n` +
                     `- Start: ${startStr}\n` +
                     `- End: ${endStr}\n` +
                     `- URL: ${event.url}`;
            }).join('\n\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `# Calendar Events (${events.length} found)\n\n${eventsText}`,
                },
                createUIResource({
                  uri: `ui://calendar/${Date.now()}`,
                  content: { type: 'rawHtml', htmlString: this.createCalendarUI(events) },
                  encoding: 'text'
                })
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error(`Error in tool ${name}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GitHub Calendar MCP server running on stdio');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

const server = new GitHubCalendarMCPServer();
server.run().catch(console.error);
