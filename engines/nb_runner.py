"""Python bridge: wraps notebooklm-py for SmartBuyers Node.js backend.

Usage (from Node):
  python -m engines.nb_runner <action> [args...]

All output is JSON to stdout. Errors to stderr.
Uses CLI subprocess for all operations (bypasses Python API auth issues).
"""
import asyncio, json, subprocess, sys
from pathlib import Path

PY = sys.executable
CLI = [PY, "-m", "notebooklm"]


def _cli(*args, timeout=120):
    """Run notebooklm CLI, return parsed JSON or raw text."""
    r = subprocess.run(CLI + list(args), capture_output=True, text=True, timeout=timeout)
    out = r.stdout.strip()
    if r.returncode != 0:
        # Try to parse JSON error
        if out.startswith("{"):
            err = json.loads(out)
            raise Exception(err.get("message", err.get("error", str(err))))
        raise Exception(r.stderr.strip() or out)
    if out.startswith("{"):
        return json.loads(out)
    return {"text": out}


async def cmd_status(client):
    """Check auth + list notebooks."""
    try:
        data = _cli("list", "--json", timeout=30)
        return {"auth": True, "notebooks": len(data.get("notebooks", []))}
    except Exception as e:
        return {"auth": False, "error": str(e)}


async def cmd_list(client):
    data = _cli("list", "--json", timeout=30)
    items = data.get("notebooks", data if isinstance(data, list) else [])
    if isinstance(items, list):
        return [{"id": n.get("id"), "title": n.get("title"), "created_at": n.get("created_at")} for n in items]
    return items


async def cmd_create(client, name):
    data = _cli("create", name, "--json", timeout=60)
    nb = data.get("notebook", data)
    return {"id": nb.get("id"), "title": nb.get("title", name)}


async def cmd_delete(client, nb_id):
    _cli("delete", nb_id, "--json", timeout=30)
    return {"deleted": nb_id}


async def cmd_notebook_summary(client, nb_id):
    return _cli("summary", "-n", nb_id, "--json", timeout=60)


async def cmd_sources(client, nb_id):
    return _cli("source", "list", "-n", nb_id, "--json", timeout=30)


async def cmd_source_guide(client, nb_id, source_id):
    return _cli("source", "guide", "-n", nb_id, source_id, "--json", timeout=60)


async def cmd_add_research(client, nb_id, query, mode="fast"):
    return _cli("source", "add-research", "-n", nb_id, query, "--mode", mode, "--json", timeout=300)


async def cmd_generate_report(client, nb_id, fmt="briefing-doc", description=""):
    args = ["generate", "report", "-n", nb_id, "--format", fmt, "--wait", "--json"]
    if description:
        args.extend(["--description", description])
    return _cli(*args, timeout=300)


async def cmd_generate_audio(client, nb_id, fmt="deep-dive", description=""):
    args = ["generate", "audio", "-n", nb_id, "--format", fmt, "--wait", "--json"]
    if description:
        args.extend(["--description", description])
    return _cli(*args, timeout=600)


async def cmd_ask(client, nb_id, question):
    return _cli("ask", "-n", nb_id, question, "--json", timeout=180)


async def cmd_init_context(client, nb_id):
    """Read systemprompt.md and add it as a text source to a notebook."""
    sp_path = Path(__file__).parent.parent / "systemprompt.md"
    if not sp_path.exists():
        return {"error": "systemprompt.md not found", "path": str(sp_path)}
    content = sp_path.read_text("utf-8")
    max_len = 4000
    if len(content) > max_len:
        content = content[:max_len] + "\n\n[... trimmed ...]"
    return await cmd_source_add(client, nb_id, content, "text", "SmartBuyers System Prompt")


async def cmd_source_add(client, nb_id, content, source_type="auto", title=""):
    """Add a URL / file / text source to a notebook."""
    args = ["source", "add", "-n", nb_id, "--json"]
    if source_type != "auto":
        args.extend(["--type", source_type])
    if title:
        args.extend(["--title", title])
    args.append(content)
    return _cli(*args, timeout=120)


async def cmd_rename(client, nb_id, title):
    return _cli("rename", nb_id, title, "--json", timeout=30)


async def cmd_download(client, nb_id, artifact_type, artifact_id):
    """Download a generated artifact (report, audio, etc.)."""
    return _cli("download", artifact_type, "-n", nb_id, artifact_id, "--json", timeout=120)


async def cmd_artifact_list(client, nb_id, artifact_type="all", limit=""):
    """List artifacts in a notebook."""
    args = ["artifact", "list", "-n", nb_id, "--json"]
    if artifact_type != "all":
        args.extend(["--type", artifact_type])
    if limit:
        args.extend(["--limit", str(limit)])
    return _cli(*args, timeout=60)


async def cmd_metadata(client, nb_id):
    return _cli("metadata", "-n", nb_id, "--json", timeout=30)


async def cmd_doctor(client):
    """Check auth status and diagnose issues."""
    try:
        data = _cli("doctor", "--json", timeout=15)
        return {"auth": True, **data}
    except Exception as e:
        return {"auth": False, "error": str(e)}


async def cmd_login(client):
    """Trigger browser login (spawns detached)."""
    try:
        subprocess.Popen(CLI + ["login"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        return {"ok": True, "message": "Otworzono przegladarke. Zaloguj sie i wroc tutaj."}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def cmd_logout(client):
    """Clear saved authentication."""
    try:
        result = _cli("auth", "logout", timeout=15)
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


ACTIONS = {
    "status": cmd_status,
    "list": cmd_list,
    "create": cmd_create,
    "delete": cmd_delete,
    "rename": cmd_rename,
    "notebook-summary": cmd_notebook_summary,
    "sources": cmd_sources,
    "source-guide": cmd_source_guide,
    "source-add": cmd_source_add,
    "init-context": cmd_init_context,
    "add-research": cmd_add_research,
    "generate-report": cmd_generate_report,
    "generate-audio": cmd_generate_audio,
    "download": cmd_download,
    "artifact-list": cmd_artifact_list,
    "ask": cmd_ask,
    "metadata": cmd_metadata,
    "doctor": cmd_doctor,
    "login": cmd_login,
    "logout": cmd_logout,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ACTIONS:
        print(json.dumps({"error": f"Actions: {', '.join(sorted(ACTIONS.keys()))}"}), file=sys.stderr)
        sys.exit(1)

    action = sys.argv[1]
    args = [a for a in sys.argv[2:] if not a.startswith("--")]
    kwargs = {}
    i = 2
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg.startswith("--") and "=" not in arg:
            key = arg[2:]
            if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
                kwargs[key] = sys.argv[i + 1]
                i += 2
            else:
                kwargs[key] = True
                i += 1
        elif arg.startswith("--") and "=" in arg:
            key, val = arg[2:].split("=", 1)
            kwargs[key] = val
            i += 1
        else:
            i += 1

    # Build positional args based on action
    handler = ACTIONS[action]
    async def run():
        client = None  # unused, all ops via CLI
        if action == "status":
            return await handler(None)
        elif action in ("list", "doctor", "login", "logout"):
            return await handler(None)
        elif action in ("create",):
            return await handler(None, args[0] if args else "SmartBuyers Notebook")
        elif action in ("delete",):
            return await handler(None, args[0])
        elif action in ("notebook-summary", "sources", "metadata"):
            return await handler(None, args[0])
        elif action == "init-context":
            return await handler(None, args[0] if args else "")
        elif action == "source-guide":
            return await handler(None, args[0], args[1] if len(args) > 1 else kwargs.get("source_id", ""))
        elif action == "add-research":
            return await handler(None, args[0], args[1] if len(args) > 1 else kwargs.get("query", ""), kwargs.get("mode", "fast"))
        elif action in ("generate-report",):
            return await handler(None, args[0], kwargs.get("format", "briefing-doc"), args[1] if len(args) > 1 else "")
        elif action in ("generate-audio",):
            return await handler(None, args[0], kwargs.get("format", "deep-dive"), args[1] if len(args) > 1 else "")
        elif action in ("ask",):
            return await handler(None, args[0], args[1] if len(args) > 1 else "")
        elif action == "source-add":
            return await handler(None, args[0], args[1], kwargs.get("type", "auto"), kwargs.get("title", ""))
        elif action == "rename":
            return await handler(None, args[0], args[1] if len(args) > 1 else "")
        elif action == "download":
            fmt = kwargs.get("format", args[1] if len(args) > 1 else "report")
            return await handler(None, args[0], fmt, args[2] if len(args) > 2 else "")
        elif action == "artifact-list":
            return await handler(None, args[0] if args else "", kwargs.get("type", "all"), kwargs.get("limit", ""))
        else:
            print(json.dumps({"error": f"Unhandled action: {action}"}), file=sys.stderr)
            sys.exit(1)

    try:
        result = asyncio.run(run())
        print(json.dumps(result, ensure_ascii=False, default=str) if not isinstance(result, str) else result)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__, "action": action}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
