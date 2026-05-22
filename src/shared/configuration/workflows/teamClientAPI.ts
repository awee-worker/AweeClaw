import { backendApi, isAuthenticated } from '@services/backendApi';

export interface TeamMemberEntry {
  id: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    username: string | null;
    avatarUrl: string | null;
  };
}

export interface TeamEntry {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  ownerId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  members?: TeamMemberEntry[];
  myRole?: string;
  _count?: {
    members: number;
    permissions: number;
  };
}

const BASE = '/api/v1/teams';

export const teamClientAPI = {
  isAvailable(): boolean {
    return isAuthenticated();
  },

  async listMine(): Promise<TeamEntry[]> {
    return backendApi.get<TeamEntry[]>(BASE) as Promise<TeamEntry[]>;
  },

  async get(teamId: string): Promise<TeamEntry> {
    return backendApi.get<TeamEntry>(`${BASE}/${teamId}`) as Promise<TeamEntry>;
  },

  async create(data: {
    name: string;
    description?: string;
    avatarUrl?: string;
  }): Promise<TeamEntry> {
    return backendApi.post<TeamEntry>(BASE, data) as Promise<TeamEntry>;
  },

  async update(
    teamId: string,
    data: { name?: string; description?: string; avatarUrl?: string },
  ): Promise<TeamEntry> {
    return backendApi.put<TeamEntry>(`${BASE}/${teamId}`, data) as Promise<TeamEntry>;
  },

  async delete(teamId: string): Promise<void> {
    return backendApi.delete<void>(`${BASE}/${teamId}`) as Promise<void>;
  },

  async getMembers(teamId: string): Promise<TeamMemberEntry[]> {
    return backendApi.get<TeamMemberEntry[]>(
      `${BASE}/${teamId}/members`,
    ) as Promise<TeamMemberEntry[]>;
  },

  async addMember(teamId: string, userId: string): Promise<TeamMemberEntry> {
    return backendApi.post<TeamMemberEntry>(`${BASE}/${teamId}/members`, {
      userId,
    }) as Promise<TeamMemberEntry>;
  },

  async batchAddMembers(
    teamId: string,
    userIds: string[],
  ): Promise<TeamMemberEntry[]> {
    return backendApi.post<TeamMemberEntry[]>(`${BASE}/${teamId}/members/batch`, {
      userIds,
    }) as Promise<TeamMemberEntry[]>;
  },

  async removeMember(teamId: string, userId: string): Promise<void> {
    return backendApi.delete<void>(
      `${BASE}/${teamId}/members/${userId}`,
    ) as Promise<void>;
  },

  async updateMemberRole(
    teamId: string,
    memberUserId: string,
    role: string,
  ): Promise<TeamMemberEntry> {
    return backendApi.put<TeamMemberEntry>(
      `${BASE}/${teamId}/members/${memberUserId}/role`,
      { role },
    ) as Promise<TeamMemberEntry>;
  },
};