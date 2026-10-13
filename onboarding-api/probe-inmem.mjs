import { GraftConfig, TeamPermissionsService } from "@graft/npm-team-permissions-service";
GraftConfig.setConfig(process.env.GRAFT_CONFIG);
console.log("result:", await TeamPermissionsService.getUserPermissions("team-apollo", "user-1001"));
process.exit(0);
