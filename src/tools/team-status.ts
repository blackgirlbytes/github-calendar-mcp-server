import { GitHubClient } from '../github/client.js';
import { TeamStatus, TeamMember, GitHubIssue } from '../types.js';
import { isToday, isThisWeek, parseISO } from 'date-fns';

export class TeamStatusTool {
  private githubClient: GitHubClient;

  constructor(githubToken: string) {
    this.githubClient = new GitHubClient(githubToken);
  }

  async getTeamStatus(): Promise<TeamStatus> {
    try {
      // Get all open issues for the team
      const issues = await this.githubClient.getAllTeamIssues();
      
      // Get unique assignees
      const assigneeLogins = this.githubClient.getUniqueAssignees(issues);
      
      // Build team member data
      const members: TeamMember[] = [];
      
      for (const login of assigneeLogins) {
        const memberIssues = issues.filter(issue => 
          issue.assignees.some(assignee => assignee.login === login)
        );
        
        const activeIssues = memberIssues.filter(issue => issue.state === 'open').length;
        const dueToday = this.countDueToday(memberIssues);
        const completedThisWeek = await this.getCompletedThisWeek(login);
        
        // Get avatar from first issue assignee data
        const avatarUrl = memberIssues[0]?.assignees.find(a => a.login === login)?.avatar_url || '';
        
        members.push({
          login,
          avatar_url: avatarUrl,
          activeIssues,
          dueToday,
          completedThisWeek,
          issues: memberIssues
        });
      }

      // Sort by workload (most active first)
      members.sort((a, b) => b.activeIssues - a.activeIssues);

      const totalActiveIssues = members.reduce((sum, member) => sum + member.activeIssues, 0);
      const totalDueToday = members.reduce((sum, member) => sum + member.dueToday, 0);

      return {
        members,
        totalActiveIssues,
        totalDueToday,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting team status:', error);
      throw error;
    }
  }

  private countDueToday(issues: GitHubIssue[]): number {
    return issues.filter(issue => {
      // Check if milestone has due date today
      if (issue.milestone?.due_on) {
        return isToday(parseISO(issue.milestone.due_on));
      }
      // For MVP, we'll just check milestone due dates
      // In production, you might check project custom fields for due dates
      return false;
    }).length;
  }

  private async getCompletedThisWeek(assignee: string): Promise<number> {
    try {
      // Get closed issues for this assignee from this week
      const closedIssues = await this.githubClient.getIssues({
        state: 'closed',
        assignee,
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // Last 7 days
      });

      return closedIssues.filter(issue => {
        if (issue.closed_at) {
          return isThisWeek(parseISO(issue.closed_at));
        }
        return false;
      }).length;
    } catch (error) {
      console.error(`Error getting completed issues for ${assignee}:`, error);
      return 0; // Return 0 if we can't fetch, don't break the whole status
    }
  }
}
