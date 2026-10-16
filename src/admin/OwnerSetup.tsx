import React, { useState } from "react";
import type { Identity } from "../types";
import { GitDataWriter } from "../lib/writer.mjs";
export default function OwnerSetup({
  identity,
  dataKey,
  accessKey,
  epoch,
  access,
  onConnected,
}: {
  identity: Identity;
  dataKey: CryptoKey;
  accessKey: CryptoKey | null;
  epoch: string;
  access: any;
  onConnected: (result: any, writer: any) => void;
}) {
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!token.trim().startsWith("github_pat_")) {
      setError("Вставьте fine-grained токен, а не пароль GitHub.");
      return;
    }
    setBusy(true);
    try {
      const writer = new GitDataWriter({
        token: token.trim(),
        key: dataKey,
        epoch,
        identity,
      });
      const result = await writer.savePublishingToken({
        accessKey,
        access,
        token: token.trim(),
      });
      onConnected(result, writer);
      setToken("");
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (identity.id !== "admin")
    return (
      <section className="owner-setup">
        <h1>Только для Алексея</h1>
        <p>Войдите под admin, чтобы подключить публикацию.</p>
        <a href="#/feed">На главную</a>
      </section>
    );
  return (
    <section className="owner-setup">
      <h1>Настройка публикации — только для Алексея</h1>
      <p>
        Руководитель не использует этот экран. Он входит по паролю admin на
        любом устройстве.
      </p>
      <p>
        Токен: fine-grained, только LeSauteur/FRchat-data, Contents: Read and
        write. Токен будет зашифрован ключом от длинного пароля admin и сохранён
        в FRchat-data. Пользовательские пароли его не открывают.
      </p>
      {done ? (
        <div className="notice">
          <h2>Публикация подключена</h2>
          <p>Теперь руководителю достаточно пароля admin.</p>
          <a className="primary" href="#/feed">
            Открыть главную руководителя
          </a>
        </div>
      ) : (
        <form onSubmit={connect}>
          <label htmlFor="owner-token">
            GitHub-токен для FRchat-data
            <input
              id="owner-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy || !token.trim()}>
            {busy ? "Подключаем…" : "Подключить публикацию"}
          </button>
        </form>
      )}
      <p>
        <a href="#/feed">Вернуться на главную</a>
      </p>
    </section>
  );
}
