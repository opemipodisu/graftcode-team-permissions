import { useEffect, useState } from "react";
import {
  GraftConfig,
  TeamPermissionsService,
} from "@graft/npm-team-permissions-service";

GraftConfig.host = "ws://localhost:8080/ws";
GraftConfig.stateless = true;

const TEAM_ID = "team-apollo";
const ACTING_USER = "user-1001";

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  permissionCount: number;
};

export default function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [canManageRoles, setCanManageRoles] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Loading team...");

  async function load() {
    const raw = await TeamPermissionsService.getTeamMembers(TEAM_ID);
    const allowed = await TeamPermissionsService.hasPermission(
      TEAM_ID,
      ACTING_USER,
      "member.role.update"
    );

    setMembers(JSON.parse(raw).members);
    setCanManageRoles(allowed);
    setStatus("");
  }

  useEffect(() => {
    load().catch((err) => setStatus(`Failed: ${String(err)}`));
  }, []);

  async function changeRole(targetUserId: string, newRole: string) {
    setStatus(`Updating ${targetUserId}...`);
    const raw = await TeamPermissionsService.updateMemberRole(
      TEAM_ID,
      ACTING_USER,
      targetUserId,
      newRole
    );
    const result = JSON.parse(raw);
    setStatus(result.ok ? "" : `Rejected: ${result.reason}`);
    await load();
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 820 }}>
      <h1>Team Apollo</h1>
      <p>
        Role management is{" "}
        <strong data-testid="can-manage">
          {canManageRoles === null ? "..." : canManageRoles ? "enabled" : "disabled"}
        </strong>{" "}
        for the signed-in user.
      </p>

      {status && <p data-testid="status">{status}</p>}

      <table cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Name</th>
            <th>Role</th>
            <th>Permissions</th>
            <th>Change role</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} style={{ borderBottom: "1px solid #eee" }}>
              <td>
                {m.name}
                <br />
                <small>{m.email}</small>
              </td>
              <td>{m.role}</td>
              <td>{m.permissionCount}</td>
              <td>
                <select
                  value={m.role}
                  disabled={!canManageRoles || m.role === "owner"}
                  onChange={(e) => changeRole(m.userId, e.target.value)}
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
