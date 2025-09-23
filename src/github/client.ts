import { Octokit } from '@octokit/rest';
import { GitHubIssue } from '../types.js';

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner?: string, repo?: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner || process.env.GITHUB_OWNER || 'squareup';
    this.repo = repo || process.env.GITHUB_REPO || 'devrel';
  }

  async getIssues(options: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    assignee?: string;
    since?: string;
  } = {}): Promise<GitHubIssue[]> {
    try {
      const params: any = {
        owner: this.owner,
        repo: this.repo,
        state: options.state || 'open',
        per_page: 100,
        sort: 'updated',
        direction: 'desc'
      };

      if (options.labels && options.labels.length > 0) {
        params.labels = options.labels.join(',');
      }

      if (options.assignee) {
        params.assignee = options.assignee;
      }

      if (options.since) {
        params.since = options.since;
      }

      console.error(`Fetching issues for ${this.owner}/${this.repo} with params:`, params);
      const response = await this.octokit.rest.issues.listForRepo(params);
      
      // Filter out pull requests (GitHub API includes PRs in issues)
      return response.data.filter(issue => !issue.pull_request) as GitHubIssue[];
    } catch (error) {
      console.error('Error fetching GitHub issues:', error);
      console.error(`Repository: ${this.owner}/${this.repo}`);
      throw new Error(`Failed to fetch issues: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getIssuesByAssignee(assignee: string): Promise<GitHubIssue[]> {
    return this.getIssues({ assignee, state: 'open' });
  }

  async getAllTeamIssues(): Promise<GitHubIssue[]> {
    // For MVP, we'll get all open issues and group by assignee
    // In production, you might want to filter by specific labels or teams
    return this.getIssues({ 
      state: 'open'
      // Remove specific label filtering for now to get all issues
    });
  }

  // Helper method to get unique assignees from issues
  getUniqueAssignees(issues: GitHubIssue[]): string[] {
    const assignees = new Set<string>();
    
    issues.forEach(issue => {
      issue.assignees.forEach(assignee => {
        assignees.add(assignee.login);
      });
    });

    return Array.from(assignees);
  }
}
