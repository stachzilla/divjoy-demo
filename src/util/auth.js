import React, {
  useState,
  useEffect,
  useMemo,
  useContext,
  createContext,
} from "react";
import auth0 from "./auth0";
import firebase from "./firebase";
import { useUser, createUser, updateUser } from "./db";
import { apiRequest, CustomError } from "./util";
import { history } from "./router";
import PageLoader from "./../components/PageLoader";
import { getFriendlyPlanId } from "./prices";
import analytics from "./analytics";

// Whether to merge extra user data from database into auth.user
const MERGE_DB_USER = true;

// Whether to connect analytics session to user.uid
const ANALYTICS_IDENTIFY = true;

const authContext = createContext();

// Context Provider component that wraps your app and makes auth object
// available to any child component that calls the useAuth() hook.
export function AuthProvider({ children }) {
  const auth = useAuthProvider();
  return <authContext.Provider value={auth}>{children}</authContext.Provider>;
}

// Hook that enables any component to subscribe to auth state
export const useAuth = () => {
  return useContext(authContext);
};

// Provider hook that creates auth object and handles state
function useAuthProvider() {
  // Store auth user object
  const [user, setUser] = useState(null);

  // Format final user object and merge extra data from database
  const finalUser = usePrepareUser(user);

  // Connect analytics session to user
  useIdentifyUser(finalUser);

  // Handle response from authentication functions
  const handleAuth = async (user) => {
    // Fetch and set a custom Firebase auth token so that we can query
    // Firestore DB (its security rules need to be able to read the auth uid)
    await setFirebaseToken();

    // Ensure Firebase is actually ready before we continue
    await waitForFirebase();

    // Create the user in the database
    // Auth0 doesn't indicate if they are new so we attempt to create user every time
    await createUser(user.sub, { email: user.email });

    // Update user in state
    setUser(user);
    return user;
  };

  const signup = (email, password) => {
    return auth0.extended
      .signupAndAuthorize({
        email: email,
        password: password,
      })
      .then(handleAuth);
  };

  const signin = (email, password) => {
    return auth0.extended
      .login({
        username: email,
        password: password,
      })
      .then(handleAuth);
  };

  const signinWithProvider = (name) => {
    // Get current domain
    const domain =
      window.location.protocol +
      "//" +
      window.location.hostname +
      (window.location.port ? ":" + window.location.port : "");

    const providerId = allProviders.find((p) => p.name === name).id;

    return auth0.extended
      .popupAuthorize({
        redirectUri: `${domain}/auth0-callback`,
        connection: providerId,
      })
      .then(handleAuth);
  };

  const signout = () => {
    // Remove custom Firebase token we set for writing to Firestore
    firebase.auth().signOut();

    return auth0.extended.logout();
  };

  const sendPasswordResetEmail = (email) => {
    return auth0.extended.changePassword({
      email: email,
    });
  };

  const confirmPasswordReset = (password, code) => {
    // This method is not needed with Auth0 but added in case your exported
    // Divjoy template makes a call to auth.confirmPasswordReset(). You can remove it.
    return Promise.reject(
      new CustomError(
        "not_needed",
        "Auth0 handles the password reset flow for you. You can remove this section or page."
      )
    );
  };

  const updateEmail = (email) => {
    return auth0.extended.updateEmail(email).then(() => {
      setUser({ ...user, email });
    });
  };

  const updatePassword = (password) => {
    return auth0.extended.updatePassword(password);
  };

  // Update auth user and persist to database (including any custom values in data)
  // Forms can call this function instead of multiple auth/db update functions
  const updateProfile = async (data) => {
    const { email, name, picture } = data;

    // Update auth email
    if (email) {
      await auth0.extended.updateEmail(email);
    }

    // Update auth profile fields
    if (name || picture) {
      let fields = {};
      if (name) fields.name = name;
      if (picture) fields.picture = picture;
      await auth0.extended.updateProfile(fields);
    }

    // Persist all data to the database
    await updateUser(user.sub, data);

    // Update user in state
    const currentUser = await auth0.extended.getCurrentUser();
    setUser(currentUser);
  };

  useEffect(() => {
    // Subscribe to user on mount
    const unsubscribe = auth0.extended.onChange(async (user) => {
      if (user) {
        // Ensure Firebase is actually ready before we continue
        // We exchanged a Auth0 token for a Firebase token in setFirebaseToken
        // so that we can make authenticated requests to Firestore.
        await waitForFirebase();

        setUser(user);
      } else {
        setUser(false);
      }
    });

    // Unsubscribe on cleanup
    return () => unsubscribe();
  }, []);

  return {
    user: finalUser,
    signup,
    signin,
    signinWithProvider,
    signout,
    sendPasswordResetEmail,
    confirmPasswordReset,
    updateEmail,
    updatePassword,
    updateProfile,
  };
}

// Format final user object and merge extra data from database
function usePrepareUser(user) {
  // Fetch extra data from database (if enabled and auth user has been fetched)
  const userDbQuery = useUser(MERGE_DB_USER && user && user.sub);

  // Memoize so we only create a new object if user or userDbQuery changes
  return useMemo(() => {
    // Return if auth user is null (loading) or false (not authenticated)
    if (!user) return user;

    // Data we want to include from auth user object
    let finalUser = {
      uid: user.sub,
      email: user.email,
      emailVerified: user.email_verified,
      name: user.name,
      picture: user.picture,
    };

    // Get the provider which is prepended to user.sub
    const providerId = user.sub.split("|")[0];
    // Include an array of user's auth provider, such as ["password"]
    // Components can read this to prompt user to re-auth with the correct provider
    // In the future this may contain multiple if Auth0 Account Linking is implemented.
    const providerName = allProviders.find((p) => p.id === providerId).name;
    finalUser.providers = [providerName];

    // If merging user data from database is enabled ...
    if (MERGE_DB_USER) {
      switch (userDbQuery.status) {
        case "idle":
          // Return null user until we have db data to merge
          return null;
        case "loading":
          return null;
        case "error":
          // Log query error to console
          console.error(userDbQuery.error);
          return null;
        case "success":
          // If user data doesn't exist we assume this means user just signed up and the createUser
          // function just hasn't completed. We return null to indicate a loading state.
          if (userDbQuery.data === null) return null;

          // Merge user data from database into finalUser object
          Object.assign(finalUser, userDbQuery.data);

          // Get values we need for setting up some custom fields below
          const { stripePriceId, stripeSubscriptionStatus } = userDbQuery.data;

          // Add planId field (such as "basic", "premium", etc) based on stripePriceId
          if (stripePriceId) {
            finalUser.planId = getFriendlyPlanId(stripePriceId);
          }

          // Add planIsActive field and set to true if subscription status is "active" or "trialing"
          finalUser.planIsActive = ["active", "trialing"].includes(
            stripeSubscriptionStatus
          );

        // no default
      }
    }

    return finalUser;
  }, [user, userDbQuery]);
}

// A Higher Order Component for requiring authentication
export const requireAuth = (Component) => {
  return (props) => {
    // Get authenticated user
    const auth = useAuth();

    useEffect(() => {
      // Redirect if not signed in
      if (auth.user === false) {
        history.replace("/auth/signin");
      }
    }, [auth]);

    // Show loading indicator
    // We're either loading (user is null) or we're about to redirect (user is false)
    if (!auth.user) {
      return <PageLoader />;
    }

    // Render component now that we have user
    return <Component {...props} />;
  };
};

const allProviders = [
  {
    id: "auth0",
    name: "password",
  },
  {
    id: "google-oauth2",
    name: "google",
  },
  {
    id: "facebook",
    name: "facebook",
  },
  {
    id: "twitter",
    name: "twitter",
  },
  {
    id: "github",
    name: "github",
  },
];

// Connect analytics session to current user.uid
function useIdentifyUser(user) {
  useEffect(() => {
    if (ANALYTICS_IDENTIFY && user) {
      analytics.identify(user.uid);
    }
  }, [user]);
}

function setFirebaseToken() {
  return apiRequest("auth-firebase-token").then((token) => {
    return firebase.auth().signInWithCustomToken(token);
  });
}

// Waits on Firebase user to be initialized before resolving promise
// This is used to ensure auth is ready before any writing to the db can happen
const waitForFirebase = () => {
  return new Promise((resolve) => {
    const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        resolve(user); // Resolve promise when we have a user
        unsubscribe(); // Prevent from firing again
      }
    });
  });
};
