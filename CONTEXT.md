# Codemini

Codemini is a local-first agent whose skills are routed by invocation mode and execution context.

## Skills

**Skill mode**:
The invocation policy of a skill: `always`, `agent_requested`, or `manual`.
_Avoid_: Storage scope

**Always skill**:
A skill whose complete instructions are present for every turn.

**Agent-requested skill**:
A discoverable skill represented in exactly one skill index and loaded on demand by the agent.

**Manual skill**:
A skill available only through explicit user selection and absent from every skill index.

**Skill store**:
The single global filesystem location that owns installed and reflected skill packages. Creating, remotely installing, updating, or reflecting a skill always writes here; the selected index context is stored separately.
_Avoid_: Project skill store, project skill scope

**Skill index**:
One of three mutually exclusive discovery catalogs: global, coding, or daily. Coding execution sees the global and coding catalogs; daily execution sees the global and daily catalogs.
_Avoid_: Project index, installation scope

**Global skill index**:
The discovery catalog shared by coding and daily execution.
_Avoid_: Global installation, global scope

**Coding skill index**:
The discovery catalog available only during coding execution.

**Daily skill index**:
The discovery catalog available only during daily execution.

When a skill is created, remotely installed, or produced by Reflect, the user chooses its index context as global, coding, or daily. This choice does not change its storage location and only affects `agent_requested` discovery.
