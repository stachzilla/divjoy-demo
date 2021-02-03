import React, { useLayoutEffect } from "react";
import auth0 from "./../util/auth0.js";

function Auth0CallbackPage(props) {
  useLayoutEffect(() => {
    // Hide body so layout components are not visible
    document.body.style.display = "none";
    // Get auth results and close popup
    auth0.popup.callback();
  }, []);

  return null;
}

export default Auth0CallbackPage;
