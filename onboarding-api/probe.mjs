import { GraftConfig, TeamPermissionsService } from "@graft/npm-team-permissions-service";
GraftConfig.host = "ws://localhost:8080/ws";
GraftConfig.stateless = true;

const perms = await TeamPermissionsService.getUserPermissions("team-apollo", "user-1002");
console.log("getUserPermissions:", perms);
console.log("hasPermission:", await TeamPermissionsService.hasPermission("team-apollo", "user-1004", "project.create"));
console.log("getTeamMembers:", await TeamPermissionsService.getTeamMembers("team-apollo"));
console.log("updateMemberRole:", await TeamPermissionsService.updateMemberRole("team-apollo", "user-1002", "user-1004", "member"));
process.exit(0);
