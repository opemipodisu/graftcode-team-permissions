import {
  GraftConfig,
  TeamPermissionsService,
} from "@graft/npm-team-permissions-service";

GraftConfig.host = process.env.PERMISSIONS_HOST ?? "ws://localhost:8080/ws";
GraftConfig.stateless = true;

export class InviteService {
  static async inviteMember(teamId, actingUserId, inviteeEmail, role) {
    const allowed = await TeamPermissionsService.hasPermission(
      teamId,
      actingUserId,
      "member.invite"
    );

    if (!allowed) {
      return { ok: false, reason: "NOT_PERMITTED" };
    }

    return { ok: true, teamId, inviteeEmail, role, invitedBy: actingUserId };
  }

  static async auditTeam(teamId) {
    const raw = await TeamPermissionsService.getTeamMembers(teamId);
    const { members } = JSON.parse(raw);

    const privileged = members.filter((m) =>
      ["owner", "admin"].includes(m.role)
    );

    return {
      teamId,
      memberCount: members.length,
      privilegedCount: privileged.length,
      privileged: privileged.map((m) => `${m.name} (${m.role})`),
    };
  }
}

if (process.argv[1]?.endsWith("index.mjs")) {
  console.log(
    "inviteMember (owner):",
    await InviteService.inviteMember(
      "team-apollo",
      "user-1001",
      "new.hire@example.com",
      "member"
    )
  );
  console.log(
    "inviteMember (viewer):",
    await InviteService.inviteMember(
      "team-apollo",
      "user-1004",
      "new.hire@example.com",
      "member"
    )
  );
  console.log("auditTeam:", await InviteService.auditTeam("team-apollo"));
  process.exit(0);
}
