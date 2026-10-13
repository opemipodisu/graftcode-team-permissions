---
title: "Build a TypeScript Service Once, Then Use It From Your Frontend and Backend"
published: false
tags: typescript, react, api, webdev
---

Every team I have worked with has a module that two different parts of the system need. Permissions is almost always one of them.

The frontend needs it so the settings page can hide the buttons a viewer should not see. A backend service needs it so the invite endpoint can reject a request from someone who is not allowed to invite anybody. Same rules, same data, same decisions.

So the capability gets integrated twice. The frontend gets a REST endpoint, a fetch wrapper, and hand written response types. The backend gets its own HTTP client, or a copy of the permission map, or worse, a second implementation that drifts out of sync three sprints later.

The business logic was written once. The integration was written twice.

This post takes a different approach. You will write a `TeamPermissionsService` in TypeScript once and expose it through [Graftcode](https://graftcode.com) Gateway. Then a React app and a separate TypeScript backend will both use the same generated package. At the end, you will move the service from a remote host into your own process by changing one setting, without touching a single call site.

<!-- TODO: publish the demo and link it here, matching the reference post's "You can find the finished project here in this GitHub repository" line. Do not ship this post with a placeholder URL. -->

## What you will learn

- Why one backend capability usually ends up with one integration per consumer
- What Receiver, Caller, Graft, and Gateway actually mean in Graftcode
- How to expose a TypeScript class as a callable service with no controllers or DTOs
- How to install the same generated package in a React frontend and in a Node.js backend
- How to switch between in process and remote execution through configuration
- Which distributed system problems this does not solve for you

## Prerequisites

This tutorial assumes you have the following:

1. [**Node.js**](https://nodejs.org/en/) 22 or higher installed locally
2. A working knowledge of TypeScript and React
3. Familiarity with REST APIs and the usual frontend to backend plumbing
4. [**Graftcode Gateway**](https://docs.graftcode.com/how-to-guides/run-gateway-locally) installed and on your `PATH`

To install Gateway, you can use the installer script:

```bash
curl -fsSL https://grft.dev/get | sh
```

On Windows, use PowerShell:

```powershell
iwr https://grft.dev/get | iex
```

You can also download a release directly from [the Gateway releases page](https://github.com/grft-dev/graftcode-gateway/releases) and put the `gg` binary on your `PATH`. Verify the install:

```bash
gg --help
```

Everything in this tutorial runs locally and does not require a Graftcode account.

## The problem: one capability, two integrations

Here is the shape of the problem. You have a permissions module. Two consumers need it.

```plaintext
TeamPermissionsService (the actual logic)
        |
        |-- REST controller + DTOs + fetch client  --> React app
        |
        |-- internal HTTP client + its own types    --> Onboarding backend
```

Both branches only move arguments and return values across a boundary. Neither contains a business rule. Both need updating when you add a permission, rename a role, or change a return shape.

The cost is not writing that code once. It is that the code keeps needing attention. Add one method and you have an endpoint to design, a route to register, a request body to validate, a response type to define, and two clients to update. Multiply that by the number of consumers.

<!-- IMAGE 1: Diagram comparing "one service, two hand written integration layers" against "one service, one generated Graft, two consumers". Place it right here. -->

![One capability with two hand written integrations](IMAGE-1)

## What is Graftcode?

[Graftcode](https://graftcode.com) makes the public methods of a module callable across processes, machines, and languages, with no API layer. You write normal code. Gateway loads it, finds the public methods, and publishes them. Consumers install a generated package and call those methods like local functions.

Four terms, used throughout the rest of this post:

- **Receiver** is the service being called. In our case that is the `TeamPermissionsService` module. Its public methods are the contract.
- **Caller** is a service doing the calling. We will have two: a React app and a Node.js backend.
- **Graft** is the generated, typed package a Caller installs with its normal package manager. You never write it by hand.
- **Gateway** is the process that hosts the Receiver module, discovers its callable surface, and publishes it so a Graft can be generated.

The key idea is that the Receiver's public method surface *is* the contract. There is no second artifact, no schema file, no spec to keep in sync. The [Graftcode documentation](https://docs.graftcode.com/core-concepts/callable-surface) calls this the callable surface, and treats it as a deliberate design decision rather than a side effect of what happens to be public.

Both of our Callers get the same generated package from that same surface.

## What we are building

A team permissions service for a SaaS application, exposing four methods:

| Method | Purpose |
| --- | --- |
| `getUserPermissions(teamId, userId)` | The role and permission list for one member |
| `hasPermission(teamId, userId, permission)` | A single yes or no authorization check |
| `getTeamMembers(teamId)` | Everyone on a team with their roles |
| `updateMemberRole(teamId, actingUserId, targetUserId, newRole)` | A guarded role change |

Then two consumers:

- A **React settings page** that lists team members and lets a permitted user change roles
- An **onboarding backend service** that checks `member.invite` before creating an invite

The project layout we are aiming for:

```plaintext
graftcode-team-permissions/
├── service/          # the Receiver: TypeScript, compiled to dist/
├── web/              # Caller 1: React + Vite
└── onboarding-api/   # Caller 2: Node.js backend
```

## Step 1: Write the TypeScript service

Create the service project:

```bash
mkdir -p graftcode-team-permissions/service/src
cd graftcode-team-permissions/service
npm init -y
npm install -D typescript @types/node
```

Now create `src/index.ts`. This is plain TypeScript. No decorators, no framework, no annotations:

```typescript
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
  { userId: "user-1001", teamId: "team-apollo", name: "Sarah Johnson", email: "sarah@example.com", role: "owner" },
  { userId: "user-1002", teamId: "team-apollo", name: "James Wilson", email: "james@example.com", role: "admin" },
  { userId: "user-1003", teamId: "team-apollo", name: "Amara Okafor", email: "amara@example.com", role: "member" },
  { userId: "user-1004", teamId: "team-apollo", name: "Daniel Brooks", email: "daniel@example.com", role: "viewer" },
];

const ASSIGNABLE_ROLES: Role[] = ["admin", "member", "viewer"];

function findMember(teamId: string, userId: string): Member | undefined {
  return members.find((m) => m.teamId === teamId && m.userId === userId);
}

export class TeamPermissionsService {
  static getUserPermissions(teamId: string, userId: string): string {
    const member = findMember(teamId, userId);

    if (!member) {
      return JSON.stringify({ userId, teamId, role: null, permissions: [], found: false });
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
      return JSON.stringify({ ok: false, reason: "ACTING_USER_NOT_PERMITTED" });
    }

    if (!ASSIGNABLE_ROLES.includes(newRole as Role)) {
      return JSON.stringify({ ok: false, reason: "ROLE_NOT_ASSIGNABLE", assignableRoles: ASSIGNABLE_ROLES });
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
```

Four choices in there are deliberate.

**Only the class is exported.** `ROLE_PERMISSIONS`, `members`, and `findMember` stay internal, so they never reach the contract. This is the most useful habit in Graftcode: the public surface is the API, so keep everything else private. The docs make the same point in [Public surface vs implementation](https://docs.graftcode.com/core-concepts/public-surface-vs-implementation).

**The methods are static.** Static input to output operations are independently routable, so any instance of your service can handle any call. Instance methods and remote object references are stateful, and Graftcode documents them as [Alpha with no durable lifetime guarantee](https://docs.graftcode.com/reference/known-limitations) across reconnects or restarts. Prefer static.

**Methods return `string`, not objects.** Parameters and return types stay on the portable baseline of `string` and `boolean`. Graftcode recommends primitives, strings, and plain models, and suggests representing dates and identifiers as strings in cross runtime contracts. Returning `JSON.stringify(...)` keeps you inside that baseline while still returning a rich shape. There is a cost, which you will see later: Callers parse the JSON themselves.

**`updateMemberRole` enforces its own rules.** The permission check, the owner protection, and the assignable role list all live in the Receiver. Once there is more than one consumer, this matters: no consumer can skip the rule.

## Step 2: Build it so Gateway can read it

Gateway needs compiled output and a `package.json` that points at it. Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Two settings here are not optional.

`"module": "CommonJS"` is needed because Gateway loads your entry module through Node's CommonJS interop. `"declaration": true` matters more than you would guess. It emits `dist/index.d.ts`, and Gateway's analyzer reads that file to recover your parameter names and types. Skip it and you lose the typing that makes this whole exercise worthwhile.

Then point `package.json` at the build output:

```json
{
  "name": "team-permissions-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  }
}
```

Build it:

```bash
npm run build
```

## Step 3: Expose it through Graftcode Gateway

Point Gateway at the project:

```bash
gg ./package.json --port 8080 --httpPort 8081
```

The default ports are 80 for service calls and 81 for Graftcode Vision. I am using 8080 and 8081 here so you do not need elevated privileges.

Gateway reads `package.json`, finds the entry point, analyzes the module, and publishes the callable surface. The first run is slow because it prepares its Node.js analyzer. Look for two things in the log. First, the discovered type:

```plaintext
[Info] Module analyzed: ./package.json
[Info] Type enabled: TeamPermissionsService
```

Then the install commands it generated, one per ecosystem:

```plaintext
[Info] Hosted module team-permissions-service installation commands:
FOR NPM PROJECT:
npm install --registry https://grft.dev/<your-registry-id>__free @graft/npm-team-permissions-service@1.0.0
```

Copy that npm command. The registry ID is specific to your Gateway run.

> Worth knowing before it bites you. Without a Project Key, the registry ID and sometimes the package name change when Gateway restarts. The docs say so in [Known limitations](https://docs.graftcode.com/reference/known-limitations), and I hit it while writing this post: changing the surface and restarting gave me `@graft/npm-team-permissions-service_3y3chy` instead of the original name. That is fine for a tutorial. For anything you intend to keep, create a free project at [portal.graftcode.com](https://portal.graftcode.com) and pass `--projectKey YOUR_PROJECT_KEY` to keep the coordinates stable.

## Step 4: Review the callable surface in Graftcode Vision

Open Graftcode Vision at `http://localhost:8081/GV`.

This is not Swagger. There are no routes, verbs, or payload schemas. You see the classes and methods you actually wrote, with their parameters and return types, a button to call each one live, and the install command for every supported ecosystem.

<!-- IMAGE 2: Screenshot of http://localhost:8081/GV showing TeamPermissionsService with all four methods and their signatures. -->

![Graftcode Vision showing the TeamPermissionsService callable surface](IMAGE-2)

Treat Vision as a review gate, not a nice extra. This is where you confirm the surface is what you meant to publish, before anybody installs a Graft. Notice what is *not* there. `findMember`, `ROLE_PERMISSIONS`, and `members` are all absent, and so are the `Role` and `Member` types. TypeScript interfaces and type aliases exist only at compile time, so they never appear in the runtime surface. For Node.js and TypeScript, the docs are explicit: the surface in Vision is authoritative, not the source file.

If Gateway discovers more than you want, you can narrow it with filters:

```bash
gg ./package.json \
  --types TeamPermissionsService \
  --methods getUserPermissions,hasPermission
```

I ran exactly that while testing, and the surface dropped to those two methods. Filters help when a module exports helpers you would rather not publish. They are the cheapest way to keep a contract small.

## Step 5: Install the Graft in the React frontend

Create the React app:

```bash
cd ..
npm create vite@latest web -- --template react-ts
cd web
npm install
```

Install the Graft using the command Gateway printed:

```bash
npm install --registry https://grft.dev/<your-registry-id>__free @graft/npm-team-permissions-service@1.0.0
```

The generated package depends on `hypertube-nodejs-sdk`, the runtime bridge that carries your calls. It uses a few Node.js built-ins that browsers do not have, so Vite needs to polyfill them:

```bash
npm install -D vite-plugin-node-polyfills
```

Update `vite.config.ts`:

```typescript
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), nodePolyfills({ exclude: ["crypto"] })],
  resolve: {
    alias: {
      crypto: resolve("./src/crypto-shim.js"),
    },
  },
});
```

And add `src/crypto-shim.js`, which routes crypto to the browser's own implementation instead of the Node polyfill:

```javascript
export const randomUUID = () => window.crypto.randomUUID();
export default { randomUUID };
```

That is the only browser specific setup: three lines of config and a two line shim, done once per frontend project.

Now look at what you actually installed. Open `node_modules/@graft/npm-team-permissions-service/TeamPermissionsService.d.ts`:

```typescript
export class TeamPermissionsService {
  static getUserPermissions(teamId: string, userId: string): Promise<string>;
  static hasPermission(
    teamId: string,
    userId: string,
    permission: string,
  ): Promise<boolean>;
  static getTeamMembers(teamId: string): Promise<string>;
  static updateMemberRole(
    teamId: string,
    actingUserId: string,
    targetUserId: string,
    newRole: string,
  ): Promise<string>;
}
```

Your parameter names and types survived. Nobody wrote this file, and nobody has to update it when the service changes. Note that every method now returns a `Promise`, including `hasPermission`, which was synchronous in the Receiver. That is expected. The generated Node.js Caller API is always asynchronous, whatever the Receiver method was.

## Step 6: Call the service from React

Replace `src/App.tsx`:

```tsx
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
        <strong>
          {canManageRoles === null ? "..." : canManageRoles ? "enabled" : "disabled"}
        </strong>{" "}
        for the signed-in user.
      </p>

      {status && <p>{status}</p>}

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
```

Two lines are the entire integration setup:

```tsx
GraftConfig.host = "ws://localhost:8080/ws";
GraftConfig.stateless = true;
```

`host` is the WebSocket endpoint of the running Gateway. You can copy it from Vision. `stateless = true` tells the runtime that these calls do not need session affinity, which is the right setting for static methods and the one you want if you ever intend to run more than one Gateway instance.

Set these before the first call. The runtime context is cached after it initializes and there is no supported way to reset it, so configuration applied after your first method call will be ignored.

Run it:

```bash
npm run dev
```

<!-- IMAGE 3: Editor screenshot showing autocomplete on TeamPermissionsService inside App.tsx, with the hover tooltip exposing the generated signature. The point is that these types were never hand written. -->

![Editor autocomplete on the generated Graft inside the React app](IMAGE-3)

There is no `fetch` in this component. No base URL, no API client module, no request body, no response type you wrote, no handling of HTTP status codes. There is no `/api/teams/:id/members` route anywhere in the project either, because there is no API.

Switch Daniel from `viewer` to `member` and watch his permission count change. Then set `ACTING_USER` to `"user-1004"` and reload. The dropdowns go disabled, because `hasPermission` now returns `false`. The frontend did not implement that rule. It asked the service.

## Step 7: Install the same Graft in a TypeScript backend

This is the part the whole post is built around. The onboarding service needs the same permission checks, so it does not get a new integration. It gets the same package.

```bash
cd ..
mkdir onboarding-api
cd onboarding-api
npm init -y
npm install --registry https://grft.dev/<your-registry-id>__free @graft/npm-team-permissions-service@1.0.0
```

Same registry. Same package. Same version. Create `index.mjs`:

```javascript
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

    // Real implementation would persist the invite and send the email here.
    return { ok: true, teamId, inviteeEmail, role, invitedBy: actingUserId };
  }

  static async auditTeam(teamId) {
    const raw = await TeamPermissionsService.getTeamMembers(teamId);
    const { members } = JSON.parse(raw);

    const privileged = members.filter((m) => ["owner", "admin"].includes(m.role));

    return {
      teamId,
      memberCount: members.length,
      privilegedCount: privileged.length,
      privileged: privileged.map((m) => `${m.name} (${m.role})`),
    };
  }
}
```

Run it and you get:

```plaintext
inviteMember (owner): {
  ok: true,
  teamId: 'team-apollo',
  inviteeEmail: 'new.hire@example.com',
  role: 'member',
  invitedBy: 'user-1001'
}
inviteMember (viewer): { ok: false, reason: 'NOT_PERMITTED' }
auditTeam: {
  teamId: 'team-apollo',
  memberCount: 4,
  privilegedCount: 2,
  privileged: [ 'Sarah Johnson (owner)', 'James Wilson (admin)' ]
}
```

Now compare the two call sites.

In React:

```tsx
const allowed = await TeamPermissionsService.hasPermission(
  TEAM_ID, ACTING_USER, "member.role.update"
);
```

In the backend:

```javascript
const allowed = await TeamPermissionsService.hasPermission(
  teamId, actingUserId, "member.invite"
);
```

Identical. Same import, same signature, same types, same package. The only difference between the two Callers is the config line telling the Graft where the Receiver lives, and here even that value is the same.

This is the point worth keeping. The React app is not a privileged consumer with its own BFF endpoint, and the backend is not importing a shared library that would couple their deploy cycles. Both are Callers. Both got the contract from the same place.

## Step 8: Move execution from remote to in process

So far both Callers have made network calls to a Gateway on port 8080. Now suppose the onboarding service becomes latency sensitive and you want the permissions module to run inside its process instead.

You do not rewrite the integration. You change configuration.

The generated package reads configuration from six source levels. Lower numbers win:

| Priority | Source |
| --- | --- |
| 1 | Graft specific environment variable |
| 2 | Global environment variable (`GRAFTCODE_CONFIG`) |
| 3 | Graft specific file (`.json`, `.yaml`, `.txt`) |
| 4 | Global file (`graftcode-config.json`, `.yaml`, `.txt`) |
| 5 | Programmatic `setConfig(...)` |
| 6 | Generated library default |

So instead of hardcoding `GraftConfig.host`, read it from the environment:

```javascript
GraftConfig.setConfig(process.env.GRAFT_CONFIG);
```

Then run remote:

```bash
GRAFT_CONFIG="name=@graft/npm-team-permissions-service;modules=team-permissions-service;runtime=nodejs;host=ws://localhost:8080/ws" \
  node index.mjs
```

Or run the same code in process:

```bash
GRAFT_CONFIG="name=@graft/npm-team-permissions-service;modules=/absolute/path/to/service/dist/index.js;runtime=nodejs;host=inmemory" \
  node index.mjs
```

Same file, same method calls, same results. One environment variable decides the topology.

Note that `modules` changes between the two. In remote mode it names the hosted module on the Gateway. In `inmemory` mode it must be a path to the actual JavaScript file, because the module now loads inside your process. Whether a Graft ships the Receiver module for in memory use is [package dependent](https://docs.graftcode.com/core-concepts/in-memory-same-machine-and-remote-execution). The one in this tutorial does not, so point `modules` at your compiled `dist/index.js`.

The words matter here. `inmemory` means the Receiver runs in your process with no network hop, but arguments and results are still represented and transferred, so it is not a direct language level call. And `ws://localhost:8080/ws` is not in memory at all. It is a real WebSocket on the loopback interface. People call both of these "local" and they are not the same thing.

## Try it locally

Let's run the whole thing. You need three terminals, since the Gateway and the two Callers are separate processes.

**Terminal 1, the Receiver.** Start Gateway from the service directory:

```bash
cd graftcode-team-permissions/service
npm run build
gg ./package.json --port 8080 --httpPort 8081
```

Wait for the line `Websocket server is available on ws://localhost:8080/ws`. The first run takes longer because Gateway extracts its runtime binaries.

One thing will trip you up. Point `gg` at the **package root**, not at `dist/index.js`. The module analyzer copies the directory of the path you give it, then expects a `package.json` inside it. Pass `dist/index.js` and you get `package.json not found after copying`. Both `./package.json` and `.` work.

**Terminal 2, the backend Caller:**

```bash
cd graftcode-team-permissions/onboarding-api
node index.mjs
```

```plaintext
inviteMember (owner): {
  ok: true,
  teamId: 'team-apollo',
  inviteeEmail: 'new.hire@example.com',
  role: 'member',
  invitedBy: 'user-1001'
}
inviteMember (viewer): { ok: false, reason: 'NOT_PERMITTED' }
auditTeam: {
  teamId: 'team-apollo',
  memberCount: 4,
  privilegedCount: 2,
  privileged: [ 'Sarah Johnson (owner)', 'James Wilson (admin)' ]
}
```

The owner can invite. The viewer cannot. That decision was made by the Receiver, not by this file.

**Terminal 3, the React Caller:**

```bash
cd graftcode-team-permissions/web
npm run dev
```

Open `http://localhost:5173/`. You should see the four team members with their roles and permission counts. Switch the acting user to the viewer and the role dropdowns disable themselves, because the page asked `hasPermission(teamId, actingUserId, "member.role.update")` and got `false`. Change a role as the owner and the table updates.

<!-- IMAGE 4: Screenshot of the running React page at localhost:5173 with the member table visible, acting user set to the owner, and the role dropdowns enabled. -->

![The team settings page running locally](IMAGE-4)

<!-- IMAGE 5: Screenshot of the same page with the acting user switched to the viewer, showing the disabled dropdowns. Place next to IMAGE 4 if the layout allows. -->

![The same page as a viewer, with role changes disabled](IMAGE-5)

Both Callers are now live against one Receiver. The React page and the Node service run different code in different runtimes, and neither contains an HTTP client.

If something does not work:

- `gg: command not found` means the binary is not on your `PATH`. Either rerun the installer or call it by absolute path.
- A connection error from either Caller usually means Gateway is not up yet. Wait for the `Websocket server is available` line before starting a Caller.
- Restarting Gateway changes the registry ID in the install command. Already installed Grafts keep working, since they are only clients, but a fresh `npm install --registry ...` needs the new ID unless you pass `--projectKey`.

## What changed and what did not

Looking back at the whole exercise:

**Written once:**
- `TeamPermissionsService` and its four methods
- The permission map and the role rules

**Generated, never hand written:**
- The typed client for the React app
- The typed client for the backend service
- All parameter and return types on both sides

**Never written at all:**
- REST controllers or route handlers
- Request and response DTOs
- A fetch wrapper or HTTP client
- An OpenAPI spec or a code generation step in CI

**Changed by configuration only:**
- Whether the module runs remotely or in process

The rule that an owner cannot be demoted lives in exactly one place. No consumer can forget it, route around it, or implement it slightly differently.

## What Graftcode does not solve for you

This is the section I would want to read if someone handed me this post, so I will be direct. Graftcode removes the integration layer. It does not remove distributed systems.

**Authentication and authorization are yours.** Graftcode's documentation lists invocation authentication as Alpha and says that if nothing is configured, no invocation authentication occurs. A Project Key is publication identity, not runtime call authorization. In this tutorial anyone who can reach port 8080 can call `updateMemberRole` with any `actingUserId` they like. Fine for a localhost demo, unacceptable in production. Browser WebSocket handshakes also cannot set custom headers, so browser Callers pass credentials as a method parameter or use the HTTP/2 configuration Vision emits.

**Failures are still failures.** A remote call can time out, the Gateway can be down, the network can partition. The call site looks like a method call, which makes that easy to forget. I stopped a Gateway mid test and got what you would expect:

```plaintext
WebSocket send to ws://localhost:8090/ws failed after 2 attempts.
Check that the server is running, the URL is correct (ws:// or wss://),
and that no firewall or proxy is blocking the connection.
```

There is no built in retry, backoff, failover, or idempotency. Retrying an invocation can repeat its effects. That is yours to design.

**Observability is yours.** Gateway exposes `GET /status` for liveness and nothing else. There is no metrics collector, no log collector, and no readiness or dependency health endpoint. W3C Trace Context propagation exists for .NET and Node.js, but you still instrument both sides yourself.

**Contract changes still need care.** Grafts update through your package manager, which is a nice workflow, but nothing guarantees an old Caller works against a new Receiver. Even additive source changes can change generated names, overloads, or exports. Pin versions and smoke test a few Callers before rollout.

**Type support is pair specific.** Graftcode is in Alpha and support is directional. Framework complex types like `DateTime` are rejected on the public surface. 64 bit integers and exact decimals need validation for a JavaScript Caller. This tutorial returns JSON strings to stay on the portable baseline. That is a real tradeoff. You give up richer typed returns for predictability, and your Callers parse JSON.

None of this is a reason to avoid Graftcode. It is a reason to be clear about what it replaced. It replaced the integration layer, which was pure overhead. The hard parts of calling another process are still hard.

## So what happens with five consumers?

This is the question that made the exercise worth doing.

Suppose permissions are needed by the React settings page, the onboarding service, an internal admin tool, a billing service that gates features by role, and a scheduled job that audits privileged accounts.

Hand written, that is five integration paths. Probably three or four clients across two or three languages, each with its own types, each needing an update when the contract changes. The integration code grows with every consumer while the business logic stays the same size.

With Graftcode all five install the same Graft from the same registry. The contract is the Receiver's public methods. Adding a sixth consumer is a package install and a configuration line.

The shift is easy to state and large in practice. The number of integration layers stops growing with the number of consumers.

## Final thoughts

The `TeamPermissionsService` in this tutorial is about 120 lines of ordinary TypeScript. No framework, no decorators, no knowledge of who calls it. From that one module, a React app and a Node.js backend both got a typed client they did not write, pointed at a host they can change with configuration.

The methods you expose become the contract. That is the whole idea, and it is why one capability stopped needing one integration per consumer.

If you try this, two things are worth attention. Keep the public surface deliberately small, and use a Project Key as soon as you care about stable package coordinates. Both save time later.

Thanks for reading. If you have questions or you build something with this, leave a comment below.

## Key takeaways

- Exporting only `TeamPermissionsService` and keeping the role map, the member store, and the lookup helper private made the contract exactly the four methods we intended. Nothing leaked in by accident.
- The public method surface is the contract, so the React app and the Node service got the same generated client from the same source. Adding a consumer became a package install instead of a new integration layer.
- Execution location is configuration, not architecture. The same call sites ran against a remote Gateway and in process. That only works because the business rules live in the Receiver and not in a translation layer.

## References

- [Graftcode documentation](https://docs.graftcode.com/) - core concepts, how-to guides, operations, and reference
- [Caller and receiver](https://docs.graftcode.com/core-concepts/caller-and-receiver) - what the two sides actually represent
- [Callable surface](https://docs.graftcode.com/core-concepts/callable-surface) - how the public method surface becomes the contract
- [Configure Graft invocation](https://docs.graftcode.com/how-to-guides/configure-graft-invocation) - setting host and execution mode
- [Configuration keys and precedence](https://docs.graftcode.com/reference/configuration-keys-and-precedence) - the six configuration source levels
- [In-memory, same-machine, and remote execution](https://docs.graftcode.com/core-concepts/in-memory-same-machine-and-remote-execution) - what each execution mode actually means
- [Known limitations](https://docs.graftcode.com/reference/known-limitations) - current Alpha status, type support, and gaps
- [Connect Frontend to Backend quick start](https://docs.graftcode.com/quick-start/connect-frontend-to-backend/react) - the shorter React walkthrough
- [Connect Microservices quick start](https://docs.graftcode.com/quick-start/connect-microservices/javascript) - the backend to backend walkthrough
