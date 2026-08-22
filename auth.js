// auth.js
// Authentication management module for Malawi Education Books and Vacancies
// Handles sign-up, sign-in, recovery, and session persistence integration

/**
 * Register a new user and create an associated record in the 'profiles' table.
 * 
 * @param {string} email - Email address
 * @param {string} password - Choose a strong password
 * @param {string} fullName - Full name of student/professional
 * @param {string} phone - Active phone number (e.g. +265...)
 * @param {string} role - Default role to attempt setup (typically 'user')
 */
async function signUpUser(email, password, fullName, phone, role = "user") {
  if (!window.supabaseClient) {
    window.showError("Database system is offline. Please refresh and try again.");
    return null;
  }

  window.showLoading("Registering your student account...");

  try {
    // 1. Core user registration in Supabase Auth
    const { data, error } = await window.supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: fullName,
          phone: phone
        }
      }
    });

    if (error) throw error;

    if (data && data.user) {
      // 2. Insert profile information into custom public profiles table
      // This holds extra attributes like customizable names, roles, etc.
      const { error: profileError } = await window.supabaseClient
        .from("profiles")
        .insert([
          {
            id: data.user.id,
            full_name: fullName,
            phone: phone,
            role: role,
            created_at: new Date().toISOString()
          }
        ]);

      if (profileError) {
        console.warn("User auth registration completed, but profile entry creation deferred:", profileError.message);
        // We will fallback to attempting profiles insertion at first successful login or admin repair,
        // or just let it pass if policy allows.
      }

      window.showSuccess("Registration successful! Check your email for confirmation (if enabled).");
      return data.user;
    }
  } catch (error) {
    window.showError(error.message || "An unexpected registration error occurred.");
    console.error("Signup error details:", error);
    return null;
  } finally {
    window.hideLoading();
  }
}

/**
 * Sign in a user with email and password.
 * 
 * @param {string} email - Registered email
 * @param {string} password - Account password
 */
async function signInUser(email, password) {
  if (!window.supabaseClient) {
    window.showError("Database connection is currently unavailable.");
    return null;
  }

  window.showLoading("Signing you in...");

  try {
    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) throw error;

    if (data && data.user) {
      window.showSuccess("Welcome back!");
      return data.user;
    }
  } catch (error) {
    window.showError(error.message || "Invalid credentials. Please try again.");
    console.error("Login error details:", error);
    return null;
  } finally {
    window.hideLoading();
  }
}

/**
 * Handle user session logout.
 */
async function signOutUser() {
  if (!window.supabaseClient) return;

  console.info("[AUTH DEBUG] Logout triggered by: manual signOutUser action");
  window.showLoading("Signing out securely...");
  try {
    const { error } = await window.supabaseClient.auth.signOut();
    if (error) throw error;
    window.showSuccess("You have been successfully logged out.");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 800);
  } catch (error) {
    window.showError("Unable to cleanly log you out. Please close tab to clear.");
  } finally {
    window.hideLoading();
  }
}

/**
 * Send password reset link to user's email address.
 * 
 * @param {string} email - Registered email address
 */
async function resetPassword(email) {
  if (!window.supabaseClient) {
    window.showError("Database service is unavailable.");
    return false;
  }

  window.showLoading("Sending recovery link...");

  try {
    const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/profile.html`
    });

    if (error) throw error;

    window.showSuccess("Password reset instructions have been emailed to you.");
    return true;
  } catch (error) {
    window.showError(error.message || "Failed to submit recovery request.");
    return false;
  } finally {
    window.hideLoading();
  }
}

/**
 * Retrieve user public profile information.
 * 
 * @param {string} userId - Supabase auth user UUID
 */
async function getUserProfile(userId) {
  if (!window.supabaseClient) return null;

  try {
    const { data, error } = await window.supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Profile fetching failed:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Profile fetching failed:", error);
    return null;
  }
}

/**
 * Update the user public profile properties.
 * 
 * @param {string} userId - User UUID
 * @param {string} fullName - New Full Name value
 * @param {string} phone - New Phone number value
 */
async function updateProfile(userId, fullName, phone) {
  if (!window.supabaseClient) return false;

  window.showLoading("Saving profile modifications...");

  try {
    const { error } = await window.supabaseClient
      .from("profiles")
      .update({
        full_name: fullName,
        phone: phone,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);

    if (error) throw error;

    window.showSuccess("Your changes have been saved successfully!");
    return true;
  } catch (error) {
    window.showError(error.message || "Failed to update profile details.");
    return false;
  } finally {
    window.hideLoading();
  }
}

// Bind methods to the window scope for integration across templates
window.signUpUser = signUpUser;
window.signInUser = signInUser;
window.signOutUser = signOutUser;
window.resetPassword = resetPassword;
window.getUserProfile = getUserProfile;
window.updateProfile = updateProfile;
// ==========================================
// AUTHENTICATION SECURITY HARDENING
// ==========================================
(function() {
  // 1. Frame-Busting (Prevents pages from being embedded inside an external iframe)
  if (window.self !== window.top) {
    window.top.location = window.self.location;
  }

  // 2. Basic Token Integrity Check
  window.addEventListener('storage', function(e) {
    if (e.key && e.key.includes('supabase.auth.token')) {
      console.warn("[Auth Security] Local storage authentication token changed.");
    }
  });
})();