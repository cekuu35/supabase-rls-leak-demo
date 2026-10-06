/* rls-scanner.js — client-side Supabase/Postgres RLS mini-scan
 * Reads PUBLIC GitHub source only, from the visitor's own browser.
 * No server, no database access, no credentials.
 * Method catalog mirrors scripts/audit_rls.py (supabase-rls-leak-demo + audit-agent).
 */
(function () {
  "use strict";

  var GH_API = "https://api.github.com";
  var GH_RAW = "https://raw.githubusercontent.com";

  // ---------- fetch helpers ----------
  async function ghJSON(url) {
    var r = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("GitHub API " + r.status + (r.status === 404 ? " (repo not found / private)" : ""));
    return r.json();
  }
  async function rawText(repo, path, branch) {
    var branches = branch ? [branch, "main", "master"] : ["main", "master"];
    for (var i = 0; i < branches.length; i++) {
      try {
        var r = await fetch(GH_RAW + "/" + repo + "/" + branches[i] + "/" + path);
        if (r.ok) return r.text();
      } catch (e) { /* try next branch */ }
    }
    return null;
  }

  // ---------- catalog ----------
  var POLICY_RE = /create\s+policy\s+(?:"([^"]+)"|([^\s(]+))\s+on\s+([\w"'.]+)([\s\S]*?);/gi;

  function compactWS(s) { return (s || "").replace(/\s+/g, " ").toLowerCase(); }

  function decodeJwtPayload(token) {
    try {
      var m = /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/.exec(token || "");
      if (!m) return null;
      var b64 = m[0].split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return JSON.parse(atob(b64));
    } catch (e) { return null; }
  }

  function listInterestingFiles(tree) {
    var envFiles = [], sqlFiles = [];
    tree.forEach(function (t) {
      if (t.type !== "blob") return;
      var p = t.path;
      if (/\.env(\.|$)/.test(p) && !/\.md$/.test(p)) envFiles.push(p);
      if (/\.sql$/.test(p) && (/migration|supabase|database|^db\//i.test(p))) sqlFiles.push(p);
    });
    return { envFiles: envFiles.slice(0, 6), sqlFiles: sqlFiles.slice(0, 40) };
  }

  function scanPolicyText(content, file, findings) {
    var m;
    POLICY_RE.lastIndex = 0;
    while ((m = POLICY_RE.exec(content)) !== null) {
      var name = (m[1] || m[2] || "").trim();
      var table = (m[3] || "").replace(/"/g, "");
      var body = compactWS(m[4]);
      var toAnon = /\bto\s+anon\b/.test(body) || /\bto\s+public\b/.test(body);
      var noTo = !/\bto\s+\w/.test(body);
      var usingTrue = /using\s*\(\s*true\s*\)/.test(body);
      var checkTrue = /with\s+check\s*\(\s*true\s*\)/.test(body);
      var forSelect = /\bfor\s+select\b/.test(body);
      var forWrite = /\bfor\s+all\b/.test(body) || /\bfor\s+insert\b/.test(body) || /\bfor\s+update\b/.test(body) || /\bfor\s+delete\b/.test(body);
      if ((toAnon || noTo) && usingTrue) {
        var aud = toAnon ? "anon" : "public (no TO clause — includes anon)";
        findings.push({
          severity: "high",
          file: file,
          title: "Policy '" + name + "' on " + table + " is open to " + aud,
          detail: "USING(true) with no row predicate — anyone holding the anon key can read this table" + (forWrite ? " (and this policy covers writes)" : "") + ".",
          verify: "select policyname, roles, cmd, qual from pg_policies where tablename = '" + table + "';",
          fix: "Add TO authenticated and a row predicate (e.g. auth.uid() = user_id). For login-existence helpers, use a SECURITY DEFINER function instead of opening the table."
        });
      } else if (/\bto\s+authenticated\b/.test(body) && usingTrue && checkTrue && !forSelect) {
        findings.push({
          severity: "medium",
          file: file,
          title: "Policy '" + name + "' on " + table + " lets any authenticated user write any row",
          detail: "USING(true) WITH CHECK(true) with no row predicate — any logged-in user can rewrite rows.",
          verify: "select policyname, roles, cmd, qual, with_check from pg_policies where tablename = '" + table + "';",
          fix: "Restrict writes to the owning row: with check (auth.uid() = user_id), or scope TO the exact role."
        });
      }
    }
  }

  function scanEnvText(content, file, findings) {
    var claims = decodeJwtPayload(content);
    if (claims && claims.role === "service_role") {
      findings.push({
        severity: "critical",
        file: file,
        title: "Committed service_role JWT (project " + (claims.ref || "?") + ")",
        detail: "A full RLS-bypass key appears to be committed in public source.",
        verify: "Open the file, paste the eyJ... value into jwt.io — payload shows role=service_role.",
        fix: "Rotate the key in Supabase dashboard → Settings → API FIRST, then remove the file and purge git history."
      });
    }
    if (/sb_secret_[A-Za-z0-9_\-]{8,}/.test(content) && !/sb_secret_(replace_me|your|\.\.\.|xxx)/i.test(content)) {
      findings.push({
        severity: "critical",
        file: file,
        title: "Committed sb_secret_ key",
        detail: "A new-format secret key (full database access) appears committed.",
        verify: "Open the file — any non-placeholder sb_secret_ value is live until rotated.",
        fix: "Rotate in the Supabase dashboard, remove the file, add to .gitignore."
      });
    }
  }

  // ---------- main ----------
  async function scanRepo(input, onProgress) {
    // normalize input: URL or owner/repo
    var match = /github\.com\/([\w.-]+)\/([\w.-]+)/.exec(input);
    var repo;
    if (match) repo = match[1] + "/" + match[2].replace(/\.git$/, "");
    else if (/^[\w.-]+\/[\w.-]+$/.test(input.trim())) repo = input.trim();
    else throw new Error("Enter a GitHub repo URL or owner/repo (public repos only)");
    repo = repo.replace(/\/+$/, "");
    onProgress && onProgress("Reading repository tree…");
    var treeData = await ghJSON(GH_API + "/repos/" + repo + "/git/trees/HEAD?recursive=1");
    var files = listInterestingFiles(treeData.tree || []);
    var findings = [];

    // env files
    for (var i = 0; i < files.envFiles.length; i++) {
      onProgress && onProgress("Checking " + files.envFiles[i] + "…");
      var envContent = await rawText(repo, files.envFiles[i]);
      if (envContent) scanEnvText(envContent, files.envFiles[i], findings);
    }
    // sql migrations
    for (var j = 0; j < files.sqlFiles.length; j++) {
      onProgress && onProgress("Reading " + files.sqlFiles[j] + "…");
      var sqlContent = await rawText(repo, files.sqlFiles[j]);
      if (sqlContent) scanPolicyText(sqlContent, files.sqlFiles[j], findings);
    }
    // dedupe
    var seen = {}, out = [];
    findings.forEach(function (f) {
      var k = f.severity + "|" + f.file + "|" + f.title;
      if (!seen[k]) { seen[k] = 1; out.push(f); }
    });
    var order = { critical: 0, high: 1, medium: 2 };
    out.sort(function (a, b) { return (order[a.severity] || 9) - (order[b.severity] || 9); });
    return { repo: repo, scanned: files.envFiles.length + files.sqlFiles.length, findings: out };
  }

  window.RLSScan = { scanRepo: scanRepo };
})();
