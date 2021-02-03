import { promisify } from "es6-promisify";
import Auth0 from "auth0-js";
import { apiRequest, CustomError } from "./util.js";

// Initialize Auth0
const auth0Realm = "Username-Password-Authentication";
const auth0 = new Auth0.WebAuth({
  domain: process.env.REACT_APP_AUTH0_DOMAIN,
  clientID: process.env.REACT_APP_AUTH0_CLIENT_ID,
  audience: `https://${process.env.REACT_APP_AUTH0_DOMAIN}/api/v2/`,
  responseType: "token id_token",
  scope: "openid profile email",
});

// First let's create promisified versions of the Auth0 methods we need
// so that we can use then().catch() instead of dealing with callback hell.
// We use bind so that internally "this" still has the correct scope.

const signupAndAuthorize = promisify(auth0.signupAndAuthorize.bind(auth0));
const login = promisify(auth0.client.login.bind(auth0.client));
const popupAuthorize = promisify(auth0.popup.authorize.bind(auth0.popup));
const userInfo = promisify(auth0.client.userInfo.bind(auth0.client));
const changePassword = promisify(auth0.changePassword.bind(auth0));

// Now lets wrap our methods with extra logic, such as including a "connection" value
// and ensuring human readable errors are thrown for our UI to catch and display.
// We make these custom methods available within an auth0.extended object.

let onChangeCallback = () => null;

auth0.extended = {
  getCurrentUser: () => {
    const accessToken = getAccessToken();
    return userInfo(accessToken).catch(handleError);
  },

  signupAndAuthorize: (options) => {
    return signupAndAuthorize({
      connection: auth0Realm,
      ...options,
    })
      .then(handleAuth)
      .catch(handleError);
  },

  login: (options) => {
    return login({
      realm: auth0Realm,
      ...options,
    })
      .then(handleAuth)
      .catch(handleError);
  },

  popupAuthorize: (options) => {
    return popupAuthorize(options).then(handleAuth).catch(handleError);
  },

  // Send email so user can reset password
  changePassword: (options) => {
    return changePassword({
      connection: auth0Realm,
      ...options,
    }).catch((error) => handleError(error, true));
  },

  updateEmail: (email) => {
    return apiRequest("auth-user", "PATCH", { email });
  },

  // Update password of authenticated user
  updatePassword: (password) => {
    return apiRequest("auth-user", "PATCH", { password });
  },

  updateProfile: (data) => {
    return apiRequest("auth-user", "PATCH", data);
  },

  logout: () => {
    handleLogout();
  },

  // A method for listening to to auth changes and receiving user data in passed callback
  onChange: function (cb) {
    // Store passed callback function
    onChangeCallback = cb;

    const handleOnChange = (accessToken) => {
      if (accessToken) {
        userInfo(accessToken)
          .then(onChangeCallback)
          .catch((error) => handleError(error, true));
      } else {
        onChangeCallback(false);
      }
    };

    // Local Storage listener
    // This is ONLY called when storage is changed by another tab so we
    // must manually call onChangeCallback after any user triggered changes.
    const listener = window.addEventListener(
      "storage",
      ({ key, newValue }) => {
        if (key === TOKEN_STORAGE_KEY) {
          handleOnChange(newValue);
        }
      },
      false
    );

    // Get accessToken from storage and call handleOnChange.
    const accessToken = getAccessToken();
    handleOnChange(accessToken);

    // Return an unsubscribe function so calling function can
    // call unsubscribe when needed (such as when a component unmounts).
    return () => {
      window.removeEventListener("storage", listener);
    };
  },

  getAccessToken: () => getAccessToken(),
};

// Gets passed auth response, stores accessToken, returns user data.
const handleAuth = (response) => {
  setAccessToken(response.accessToken);
  return userInfo(response.accessToken).then((user) => {
    onChangeCallback(user);
    return user;
  });
};

const handleLogout = () => {
  removeAccessToken();
  onChangeCallback(false);
};

const handleError = (error, autoLogout = false) => {
  // If error code indicates user is unauthorized then log them out.
  // We only do this if autoLogout is enabled so we can skip in instances
  // where it's not possible its due to token expiration (such as right after login)
  // and we'd rather throw an error that can be displayed by the UI.
  if (error.code === 401 && autoLogout) {
    handleLogout();
  }

  // Find a human readable error message in an Auth0 error object and throw.
  // Unfortunately, it's not always in the same location :/
  let message;
  if (typeof error.message === "string") {
    message = error.message;
  } else if (typeof error.description === "string") {
    message = error.description;
  } else if (typeof error.original === "string") {
    message = error.original;
  } else if (error.original && typeof error.original.message === "string") {
    message = error.original.message;
  } else {
    message = error.code; // Use error.code if no better option
  }

  throw new CustomError(error.code, message);
};

// Local Storage methods
const TOKEN_STORAGE_KEY = "auth0_access_token";
const getAccessToken = () => localStorage.getItem(TOKEN_STORAGE_KEY);
const setAccessToken = (accessToken) =>
  localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
const removeAccessToken = () => localStorage.removeItem(TOKEN_STORAGE_KEY);

export default auth0;
