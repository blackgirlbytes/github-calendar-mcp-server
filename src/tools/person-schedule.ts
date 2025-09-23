import { GitHubClient } from '../github/client.js';
import { PersonSchedule, GitHubIssue } from '../types.js';
import { differenceInDays, parseISO } from 'date-fns';

export class PersonScheduleTool {
  private githubClient: GitHubClient;

  constructor(githubToken: string) {
    this.githubClient = new GitHubClient(githubToken);
  }

  async getPersonSchedule(login: string): Promise<PersonSchedule> {
    try {
      // Get open issues assigned to this person
      const issues = await this.githubClient.getIssuesByAssignee(login);
      
      // Get avatar URL from first issue
      const avatarUrl = issues[0]?.assignees.find(a => a.login === login)?.avatar_url || '';
      
      // Build upcoming issues with due date info
      const upcomingIssues = issues.map(issue => {
        const dueDate = issue.milestone?.due_on || null;
        const daysUntilDue = dueDate ? differenceInDays(parseISO(dueDate), new Date()) : null;
        
        return {
          issue,
          dueDate,
          daysUntilDue
        };
      });

      // Sort by due date (soonest first, then by creation date)
      upcomingIssues.sort((a, b) => {
        // Items with due dates come first
        if (a.daysUntilDue !== null && b.daysUntilDue === null) return -1;
        if (a.daysUntilDue === null && b.daysUntilDue !== null) return 1;
        
        // Both have due dates, sort by days until due
        if (a.daysUntilDue !== null && b.daysUntilDue !== null) {
          return a.daysUntilDue - b.daysUntilDue;
        }
        
        // Neither has due date, sort by creation date (newest first)
        return new Date(b.issue.created_at).getTime() - new Date(a.issue.created_at).getTime();
      });

      return {
        login,
        avatar_url: avatarUrl,
        upcomingIssues
      };
    } catch (error) {
      console.error(`Error getting schedule for ${login}:`, error);
      throw error;
    }
  }

  async getPersonScheduleForDateRange(login: string, days: number = 7): Promise<PersonSchedule> {
    const schedule = await this.getPersonSchedule(login);
    
    // Filter to only include issues due within the specified number of days
    const filteredIssues = schedule.upcomingIssues.filter(item => {
      if (item.daysUntilDue === null) return true; // Include items without due dates
      return item.daysUntilDue <= days; // Include items due within the range
    });

    return {
      ...schedule,
      upcomingIssues: filteredIssues
    };
  }
}
