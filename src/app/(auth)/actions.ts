"use server";

import {
  validatedAction,
  validatedActionWithUser,
} from "@/lib/auth/middleware";
import { comparePasswords, hashPassword, setSession } from "@/lib/auth/session";
import { db } from "@/lib/db/drizzle";
import { type NewUser, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  password: z.string().min(8).max(100),
});

export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { email, password } = data;

  const usersData = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (usersData.length === 0) {
    return {
      error: "Invalid email or password. Please try again.",
      data,
    };
  }

  const [user] = usersData;

  const isPasswordValid = await comparePasswords(password, user.passwordHash);

  if (!isPasswordValid) {
    return {
      error: "Invalid email or password. Please try again.",
      data,
    };
  }

  await setSession(user);

  redirect("/");
});

const signUpSchema = z
  .object({
    name: z.string().min(3, {
      message: "Name is required and must be at least 3 characters",
    }),
    email: z.string().email({
      message: "Email is invalid",
    }),
    password: z.string().min(8, {
      message: "Password is required and must be at least 8 characters",
    }),
    passwordConfirm: z.string().min(8, {
      message: "Password is required and must be at least 8 characters",
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ["passwordConfirm"],
  });

export const signUp = validatedAction(signUpSchema, async (data, _) => {
  const { name, email, password } = data;

  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    return {
      error: "Failed to create user. Please try again.",
      data,
    };
  }

  const passwordHash = await hashPassword(password);

  const newUser: NewUser = {
    name,
    email,
    passwordHash,
  };

  const [createdUser] = await db.insert(users).values(newUser).returning();

  if (!createdUser) {
    return { error: "Failed to create user. Please try again.", data };
  }

  await setSession(createdUser);

  redirect("/");
});

export async function signOut() {
  cookies().delete("session");
}

const updateAccountSchema = z.object({
  name: z.string().min(3, {
    message: "Name is required and must be at least 3 characters",
  }),
  email: z.string().email({
    message: "Email is invalid",
  }),
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const { name, email } = data;

    await db.update(users).set({ name, email }).where(eq(users.id, user.id));

    revalidatePath("/account");

    return { success: "Account updated successfully" };
  },
);

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(8, {
      message: "Password is required and must be at least 8 characters",
    }),
    newPassword: z.string().min(8, {
      message: "Password is required and must be at least 8 characters",
    }),
    passwordConfirm: z.string().min(8, {
      message: "Password is required and must be at least 8 characters",
    }),
  })
  .refine((data) => data.newPassword === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ["passwordConfirm"],
  });

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword } = data;

    const isPasswordValid = await comparePasswords(
      currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      return {
        error: "Invalid current password. Please try again.",
        data,
      };
    }

    const passwordHash = await hashPassword(newPassword);

    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

    revalidatePath("/account");

    return { success: "Password updated successfully" };
  },
);
