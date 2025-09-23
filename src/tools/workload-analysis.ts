import { GitHubClient } from '../github/client.js';
import { WorkloadAnalysis } from '../types.js';

export class WorkloadAnalysisTool {
  private githubClient: GitHubClient;

  constructor(githubToken: string) {
    this.githubClient = new GitHubClient(githubToken);
  }

  async analyzeWorkload(): Promise<WorkloadAnalysis> {
    try {
      // Get all open issues
      const issues = await this.githubClient.getAllTeamIssues();
      
      // Get unique assignees
      const assigneeLogins = this.githubClient.getUniqueAssignees(issues);
      
      // Calculate workload for each member
      const members = assigneeLogins.map(login => {
        const memberIssues = issues.filter(issue => 
          issue.assignees.some(assignee => assignee.login === login)
        );
        
        const activeIssues = memberIssues.length;
        const workloadLevel = this.categorizeWorkload(activeIssues);
        const recommendation = this.getRecommendation(workloadLevel, activeIssues);
        
        return {
          login,
          activeIssues,
          workloadLevel,
          recommendation
        };
      });

      // Sort by active issues count
      members.sort((a, b) => a.activeIssues - b.activeIssues);
      
      // Find least and most busy members
      const leastBusy = members
        .filter(m => m.workloadLevel === 'light')
        .map(m => m.login);
      
      const mostBusy = members
        .filter(m => m.workloadLevel === 'overloaded' || m.workloadLevel === 'heavy')
        .map(m => m.login);

      return {
        members,
        leastBusy,
        mostBusy
      };
    } catch (error) {
      console.error('Error analyzing workload:', error);
      throw error;
    }
  }

  async findBestAssignee(): Promise<string | null> {
    const analysis = await this.analyzeWorkload();
    
    // Return the person with the lightest workload
    if (analysis.leastBusy.length > 0) {
      return analysis.leastBusy[0];
    }
    
    // If no one has a light workload, return the person with the fewest issues
    const lightestMember = analysis.members.reduce((prev, current) => 
      prev.activeIssues < current.activeIssues ? prev : current
    );
    
    return lightestMember.login;
  }

  private categorizeWorkload(activeIssues: number): 'light' | 'moderate' | 'heavy' | 'overloaded' {
    if (activeIssues === 0) return 'light';
    if (activeIssues <= 2) return 'light';
    if (activeIssues <= 4) return 'moderate';
    if (activeIssues <= 6) return 'heavy';
    return 'overloaded';
  }

  private getRecommendation(workloadLevel: string, activeIssues: number): string {
    switch (workloadLevel) {
      case 'light':
        return activeIssues === 0 
          ? 'Available for new assignments' 
          : 'Can take on additional work';
      case 'moderate':
        return 'Good workload balance';
      case 'heavy':
        return 'At capacity, avoid new assignments';
      case 'overloaded':
        return 'Consider redistributing some tasks';
      default:
        return 'Workload status unclear';
    }
  }
}
