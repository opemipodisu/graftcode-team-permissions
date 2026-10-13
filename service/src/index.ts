type Role = "owner" | "admin" | "member" | "viewer";

interface Member {
  userId: string;
  teamId: string;
  name: string;
  email: string;
  role: Role;
}

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: [
    "team.view",
    "team.billing",
    "member.invite",
    "member.remove",
    "member.role.update",
    "project.create",
    "project.delete",
  ],
  admin: [
    "team.view",
    "member.invite",
    "member.remove",
    "member.role.update",
    "project.create",
  ],
  member: ["team.view", "project.create"],
  viewer: ["team.view"],
};

const members: Member[] = [
  {
    userId: "user-1001",
    teamId: "team-apollo",
    name: "Sarah Johnson",
    email: "sarah@example.com",
    role: "owner",
  },
  {
    userId: "user-1002",
    teamId: "team-apollo",
    name: "James Wilson",
    email: "james@example.com",
    role: "admin",
  },
  {
    userId: "user-1003",
    teamId: "team-apollo",
    name: "Amara Okafor",
    email: "amara@example.com",
    role: "member",
  },
  {
    userId: "user-1004",
    teamId: "team-apollo",
    name: "Daniel Brooks",
    email: "daniel@example.com",
    role: "viewer",
  },
];

const ASSIGNABLE_ROLES: Role[] = ["admin", "member", "viewer"];

function findMember(teamId: string, userId: string): Member | undefined {
  return members.find((m) => m.teamId === teamId && m.userId === userId);
}

export class TeamPermissionsService {
  static getUserPermissions(teamId: string, userId: string): string {
    const member = findMember(teamId, userId);

    if (!member) {
      return JSON.stringify({
        userId,
        teamId,
        role: null,
        permissions: [],
        found: false,
      });
    }

    return JSON.stringify({
      userId: member.userId,
      teamId: member.teamId,
      role: member.role,
      permissions: ROLE_PERMISSIONS[member.role],
      found: true,
    });
  }

  static hasPermission(teamId: string, userId: string, permission: string): boolean {
    const member = findMember(teamId, userId);
    if (!member) {
      return false;
    }
    return ROLE_PERMISSIONS[member.role].includes(permission);
  }

  static getTeamMembers(teamId: string): string {
    const teamMembers = members
      .filter((m) => m.teamId === teamId)
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
        permissionCount: ROLE_PERMISSIONS[m.role].length,
      }));

    return JSON.stringify({ teamId, members: teamMembers });
  }

  static updateMemberRole(
    teamId: string,
    actingUserId: string,
    targetUserId: string,
    newRole: string
  ): string {
    if (!TeamPermissionsService.hasPermission(teamId, actingUserId, "member.role.update")) {
      return JSON.stringify({
        ok: false,
        reason: "ACTING_USER_NOT_PERMITTED",
      });
    }

    if (!ASSIGNABLE_ROLES.includes(newRole as Role)) {
      return JSON.stringify({
        ok: false,
        reason: "ROLE_NOT_ASSIGNABLE",
        assignableRoles: ASSIGNABLE_ROLES,
      });
    }

    const target = findMember(teamId, targetUserId);
    if (!target) {
      return JSON.stringify({ ok: false, reason: "TARGET_NOT_FOUND" });
    }

    if (target.role === "owner") {
      return JSON.stringify({ ok: false, reason: "CANNOT_DEMOTE_OWNER" });
    }

    const previousRole = target.role;
    target.role = newRole as Role;

    return JSON.stringify({
      ok: true,
      userId: target.userId,
      previousRole,
      newRole: target.role,
      permissions: ROLE_PERMISSIONS[target.role],
    });
  }
}
