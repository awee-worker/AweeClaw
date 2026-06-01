import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Shield,
  Trash2,
  Plus,
  XCircle,
  RefreshCw,
  Search,
  Eye,
  Edit3,
  Building2,
} from 'lucide-react';
import { workflowClientAPI } from '@shared/configuration/workflows/workflowClientAPI';
import { teamClientAPI, type TeamEntry } from '@shared/configuration/workflows/teamClientAPI';
import { t, type Language } from '@renderer/i18n'

interface PermissionUser {
  id: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
}

interface PermissionTeam {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface PermissionEntry {
  id: string;
  workflowId: string;
  userId: string | null;
  teamId: string | null;
  role: string;
  grantedAt: string;
  grantedBy: string;
  user: PermissionUser | null;
  team: PermissionTeam | null;
}

interface SharePanelProps {
  workflowId: string;
  visible: boolean;
  onClose: () => void;
  language?: 'en' | 'zh';
}

const ROLE_OPTIONS = [
  { value: 'VIEWER', label: 'Viewer', labelZh: '只读', icon: Eye },
  { value: 'EDITOR', label: 'Editor', labelZh: '编辑', icon: Edit3 },
  { value: 'ADMIN', label: 'Admin', labelZh: '管理', icon: Shield },
];

type TabType = 'users' | 'teams';

export default function SharePanel({
  workflowId,
  visible,
  onClose,
  language = 'zh',
}: SharePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState('VIEWER');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [teamRole, setTeamRole] = useState('VIEWER');

  ;

  const loadPermissions = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await workflowClientAPI.getPermissions(workflowId);
      setPermissions(data || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    try {
      const data = await teamClientAPI.listMine();
      setTeams(data || []);
      if (data.length > 0 && !selectedTeamId) {
        setSelectedTeamId(data[0].id);
      }
    } catch {
      // silently fail for team loading
    } finally {
      setTeamsLoading(false);
    }
  }, [selectedTeamId]);

  useEffect(() => {
    if (visible && workflowId) {
      loadPermissions();
      loadTeams();
      setEmail('');
      setSuccessMsg(null);
    }
  }, [visible, workflowId, loadPermissions, loadTeams]);

  const handleGrant = useCallback(async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await workflowClientAPI.grantPermission(workflowId, email.trim(), selectedRole);
      setSuccessMsg(
        t('app.grantedas', language as Language, { email: email, selectedRole: selectedRole }),
      );
      setEmail('');
      await loadPermissions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [email, selectedRole, workflowId, loadPermissions, t]);

  const handleGrantTeam = useCallback(async () => {
    if (!selectedTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      await workflowClientAPI.grantTeamPermission(workflowId, selectedTeamId, teamRole);
      const teamName = teams.find((t) => t.id === selectedTeamId)?.name || selectedTeamId;
      setSuccessMsg(
        t('wf.grantedteamasrole', language as Language, { teamName, teamRole }),
      );
      await loadPermissions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [selectedTeamId, teamRole, workflowId, loadPermissions, teams, t]);

  const handleRevoke = useCallback(
    async (permId: string, name: string) => {
      try {
        await workflowClientAPI.revokePermission(workflowId, permId);
        setSuccessMsg(
          t('app.revokedpermissionfor', language as Language, { name: name }),
        );
        await loadPermissions();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [workflowId, loadPermissions, t],
  );

  const handleRoleChange = useCallback(
    async (permId: string, newRole: string, name: string) => {
      try {
        await workflowClientAPI.updatePermission(workflowId, permId, newRole);
        setSuccessMsg(
          t('wf.changedroletto', language as Language, { name, newRole }),
        );
        await loadPermissions();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [workflowId, loadPermissions, t],
  );

  const getDisplayName = (user: PermissionUser | null) => {
    if (!user) return t('app.unknown', language as Language);
    return user.username || user.email || user.id;
  };

  const userPermissions = permissions.filter((p) => p.userId && !p.teamId);
  const teamPermissions = permissions.filter((p) => p.teamId);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-h-[75vh] bg-[var(--background)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]/60">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('app.sharepermissions', language as Language)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--border)]/30 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-[var(--border)]/20">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'users'
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5 -mt-px" />
            {t('app.userpermissions', language as Language)}
          </button>
          <button
            onClick={() => setActiveTab('teams')}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'teams'
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 inline mr-1.5 -mt-px" />
            {t('app.teampermissions', language as Language)}
          </button>
        </div>

        {activeTab === 'users' && (
          <>
            <div className="p-5 border-b border-[var(--border)]/20">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-2">
                {t('app.addmemberbyemail', language as Language)}
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]/50" />
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGrant()}
                    placeholder={t('app.enteruseremail', language as Language)}
                    className="w-full h-9 pl-9 pr-3 text-sm bg-[var(--border)]/5 border border-[var(--border)]/30 rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/40 focus:outline-none focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/20 transition-colors"
                  />
                </div>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="h-9 px-3 text-sm bg-[var(--border)]/5 border border-[var(--border)]/30 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/50 cursor-pointer"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {language === 'zh' ? opt.labelZh : opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleGrant}
                  disabled={submitting || !email.trim()}
                  className="flex items-center gap-1 h-9 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('app.add', language as Language)}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {renderMessages()}
              {renderPermissionList(userPermissions)}
            </div>
          </>
        )}

        {activeTab === 'teams' && (
          <>
            <div className="p-5 border-b border-[var(--border)]/20">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-2">
                {t('app.shareworkflowwitha', language as Language)}
              </label>
              {teamsLoading ? (
                <div className="flex items-center justify-center py-3">
                  <RefreshCw className="w-4 h-4 text-[var(--accent)] animate-spin" />
                </div>
              ) : teams.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]/60 py-2">
                  {t('app.youhavenoteams', language as Language)}
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                    className="flex-1 h-9 px-3 text-sm bg-[var(--border)]/5 border border-[var(--border)]/30 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/50 cursor-pointer"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={teamRole}
                    onChange={(e) => setTeamRole(e.target.value)}
                    className="h-9 px-3 text-sm bg-[var(--border)]/5 border border-[var(--border)]/30 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/50 cursor-pointer"
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {language === 'zh' ? opt.labelZh : opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleGrantTeam}
                    disabled={submitting || !selectedTeamId}
                    className="flex items-center gap-1 h-9 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('app.share', language as Language)}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {renderMessages()}
              {renderTeamPermissionList(teamPermissions)}
            </div>
          </>
        )}

        <div className="px-5 py-3 border-t border-[var(--border)]/20 bg-[var(--border)]/5">
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]/70">
            <div className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {t('app.viewerread', language as Language)}
            </div>
            <span className="text-[var(--border)]/50">|</span>
            <div className="flex items-center gap-1">
              <Edit3 className="w-3 h-3" />
              {t('app.editoredit', language as Language)}
            </div>
            <span className="text-[var(--border)]/50">|</span>
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {t('app.adminfullshare', language as Language)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  function renderMessages() {
    return (
      <>
        {successMsg && (
          <div className="mb-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400 flex items-center justify-between">
            <span>{successMsg}</span>
            <button
              onClick={() => setSuccessMsg(null)}
              className="p-0.5 hover:bg-green-500/20 rounded"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {error && (
          <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </>
    );
  }

  function renderPermissionList(list: PermissionEntry[]) {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 text-[var(--accent)] animate-spin" />
        </div>
      );
    }

    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
          <Users className="w-8 h-8 opacity-20 mb-2" />
          <span className="text-xs">
            {t('app.notsharedwithanyone', language as Language)}
          </span>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        {list.map((perm) => {
          const RoleIcon =
            ROLE_OPTIONS.find((o) => o.value === perm.role)?.icon || Eye;
          const name = getDisplayName(perm.user);

          return (
            <div
              key={perm.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-[var(--border)]/5 hover:bg-[var(--border)]/10 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[var(--accent)]">
                  {(name[0] || '?').toUpperCase()}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {name}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]/60">
                  {perm.user?.email || ''}
                </div>
              </div>

              <select
                value={perm.role}
                onChange={(e) => handleRoleChange(perm.id, e.target.value, name)}
                className="h-7 px-2 text-xs bg-transparent border border-[var(--border)]/30 rounded-md text-[var(--text-primary)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {language === 'zh' ? opt.labelZh : opt.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                  <RoleIcon className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
                  {language === 'zh'
                    ? ROLE_OPTIONS.find((o) => o.value === perm.role)?.labelZh
                    : perm.role}
                </span>
                <button
                  onClick={() => handleRevoke(perm.id, name)}
                  className="p-1 rounded-md hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  title={t('app.revoke', language as Language)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTeamPermissionList(list: PermissionEntry[]) {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 text-[var(--accent)] animate-spin" />
        </div>
      );
    }

    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
          <Building2 className="w-8 h-8 opacity-20 mb-2" />
          <span className="text-xs">
            {t('app.notsharedwithany', language as Language)}
          </span>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        {list.map((perm) => {
          const RoleIcon =
            ROLE_OPTIONS.find((o) => o.value === perm.role)?.icon || Eye;
          const name = perm.team?.name || t('app.unknownteam', language as Language);

          return (
            <div
              key={perm.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-[var(--border)]/5 hover:bg-[var(--border)]/10 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 text-purple-500" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {name}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]/60">
                  {t('app.teamshare', language as Language)}
                </div>
              </div>

              <select
                value={perm.role}
                onChange={(e) => handleRoleChange(perm.id, e.target.value, name)}
                className="h-7 px-2 text-xs bg-transparent border border-[var(--border)]/30 rounded-md text-[var(--text-primary)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {language === 'zh' ? opt.labelZh : opt.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 font-medium">
                  <RoleIcon className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
                  {language === 'zh'
                    ? ROLE_OPTIONS.find((o) => o.value === perm.role)?.labelZh
                    : perm.role}
                </span>
                <button
                  onClick={() => handleRevoke(perm.id, name)}
                  className="p-1 rounded-md hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  title={t('app.revoke2', language as Language)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
}