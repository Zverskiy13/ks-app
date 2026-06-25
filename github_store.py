# -*- coding: utf-8 -*-
"""Чтение/запись файлов в приватном GitHub-репозитории через REST API."""
import os
import base64
import requests

TOKEN = os.environ["GITHUB_TOKEN"]
REPO = os.environ["GITHUB_REPO"]                  # "Zverskiy13/ks-telegram-bot"
BRANCH = os.environ.get("GITHUB_BRANCH", "main")
H = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}
BASE = f"https://api.github.com/repos/{REPO}/contents"


def get_file(path):
    """Вернёт (текст, sha) или (None, None), если файла нет."""
    r = requests.get(f"{BASE}/{path}?ref={BRANCH}", headers=H, timeout=30)
    if r.status_code == 200:
        j = r.json()
        return base64.b64decode(j["content"]).decode("utf-8"), j["sha"]
    return None, None


def put_file(path, text, message):
    """Создать/обновить файл. Возвращает True при успехе."""
    _, sha = get_file(path)
    data = {"message": message,
            "content": base64.b64encode(text.encode("utf-8")).decode(),
            "branch": BRANCH}
    if sha:
        data["sha"] = sha
    r = requests.put(f"{BASE}/{path}", headers=H, json=data, timeout=30)
    if r.status_code not in (200, 201):
        print(f"put_file {path} -> {r.status_code}: {r.text[:200]}")
        return False
    return True


def ensure_seeded(mapping):
    """mapping: {repo_path: local_seed_file}. Если в репо файла нет — заливаем сид."""
    for repo_path, local in mapping.items():
        content, _ = get_file(repo_path)
        if content is None and os.path.exists(local):
            with open(local, encoding="utf-8") as f:
                put_file(repo_path, f.read(), f"seed {repo_path}")
            print(f"seeded {repo_path}")
