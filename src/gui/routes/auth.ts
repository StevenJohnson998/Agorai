/**
 * Auth routes: login, register, logout
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import type { IStore } from "../../store/interfaces.js";

const BCRYPT_ROUNDS = 10;
const LOGIN_RATE_WINDOW = 15 * 60 * 1000;
const LOGIN_RATE_MAX = 10;
const REGISTER_RATE_WINDOW = 60 * 60 * 1000;
const REGISTER_RATE_MAX = 5;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const registerAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRate(map: Map<string, { count: number; resetAt: number }>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

export function createAuthRoutes(store: IStore, sessionCookie: string) {
  const router = Router();

  router.get("/login", (req, res) => {
    const bp = req.app.get("basePath") || "";
    if (req.user) return res.redirect(bp + "/test/c/");
    res.render("login", {
      error: null,
      basePath: bp,
    });
  });

  router.post("/login", async (req, res) => {
    const bp = req.app.get("basePath") || "";
    const { email, password, environment } = req.body;

    if (!email || !password) {
      return res.render("login", {
        error: "Email and password are required.",
        basePath: bp,
      });
    }

    const ip = req.ip || "unknown";
    if (!checkRate(loginAttempts, ip, LOGIN_RATE_MAX, LOGIN_RATE_WINDOW)) {
      return res.render("login", {
        error: "Too many login attempts. Please try again later.",
        basePath: bp,
      });
    }

    const user = await store.getUserByEmail(email);
    if (!user) {
      return res.render("login", {
        error: "Invalid credentials.",
        basePath: bp,
      });
    }

    if (user.accountLocked) {
      return res.render("login", {
        error: "Account is locked. Contact an administrator.",
        basePath: bp,
      });
    }

    if (user.status !== "approved") {
      return res.render("login", {
        error: user.status === "pending"
          ? "Your account is pending approval."
          : "Your account has been rejected.",
        basePath: bp,
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await store.incrementFailedLogins(user.id);
      return res.render("login", {
        error: "Invalid credentials.",
        basePath: bp,
      });
    }

    await store.resetFailedLogins(user.id);
    const sessionId = await store.createSession(
      user.id,
      req.ip,
      req.headers["user-agent"],
    );

    res.cookie(sessionCookie, sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 24 * 60 * 60 * 1000,
      path: bp || "/",
    });

    // Redirect to chosen environment (only "test" for now)
    const env = environment || "test";
    res.redirect(bp + "/" + env + "/c/");
  });

  router.get("/register", (req, res) => {
    const bp = req.app.get("basePath") || "";
    if (req.user) return res.redirect(bp + "/test/c/");
    res.render("register", {
      error: null,
      success: null,
      basePath: bp,
    });
  });

  router.post("/register", async (req, res) => {
    const bp = req.app.get("basePath") || "";
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.render("register", {
        error: "All fields are required.",
        success: null,
        basePath: bp,
      });
    }

    if (password.length < 8) {
      return res.render("register", {
        error: "Password must be at least 8 characters.",
        success: null,
        basePath: bp,
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.render("register", {
        error: "Invalid email format.",
        success: null,
        basePath: bp,
      });
    }

    const ip = req.ip || "unknown";
    if (!checkRate(registerAttempts, ip, REGISTER_RATE_MAX, REGISTER_RATE_WINDOW)) {
      return res.render("register", {
        error: "Too many registration attempts. Please try again later.",
        success: null,
        basePath: bp,
      });
    }

    const existing = await store.getUserByEmail(email);
    if (existing) {
      return res.render("register", {
        error: "An account with this email already exists.",
        success: null,
        basePath: bp,
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await store.createUser({ email, passwordHash, name });

    res.render("register", {
      error: null,
      success: "Account created. An administrator must approve your account before you can log in.",
      basePath: bp,
    });
  });

  router.post("/logout", async (req, res) => {
    const bp = req.app.get("basePath") || "";
    if (req.sessionId) {
      await store.deleteSession(req.sessionId);
    }
    res.clearCookie(sessionCookie, { path: bp || "/" });
    res.redirect(bp + "/login");
  });

  return router;
}
