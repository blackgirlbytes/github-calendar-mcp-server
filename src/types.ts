export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
  labels: Array<{
    id: number;
    name: string;
    color: string;
    description: string | null;
  }>;
  assignees: Array<{
    login: string;
    avatar_url: string;
  }>;
  milestone: {
    title: string;
    description: string | null;
    due_on: string | null;
  } | null;
}

export interface TeamMember {
  login: string;
  avatar_url: string;
  activeIssues: number;
  dueToday: number;
  completedThisWeek: number;
  issues: GitHubIssue[];
}

export interface TeamStatus {
  members: TeamMember[];
  totalActiveIssues: number;
  totalDueToday: number;
  lastUpdated: string;
}

export interface PersonSchedule {
  login: string;
  avatar_url: string;
  upcomingIssues: Array<{
    issue: GitHubIssue;
    dueDate: string | null;
    daysUntilDue: number | null;
  }>;
}

export interface WorkloadAnalysis {
  members: Array<{
    login: string;
    activeIssues: number;
    workloadLevel: 'light' | 'moderate' | 'heavy' | 'overloaded';
    recommendation: string;
  }>;
  leastBusy: string[];
  mostBusy: string[];
}
