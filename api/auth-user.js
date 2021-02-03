const requireAuth = require("./_require-auth.js");
const { managementClient } = require("./_auth0.js");

// User updates are security sensive, so we throw an error if the access token
// is older then the specified age (frontend will show a UI to reauthenticate).
const MAX_TOKEN_AGE = 3600; // 1 hour in seconds

export default requireAuth((req, res) => {
  const user = req.user;
  const body = req.body;

  // Filter fields down to just values user is allowed to update
  const allowedFields = ["email", "password", "name", "picture"];
  let updateFields = {};
  allowedFields.forEach((allowedField) => {
    if (body[allowedField] !== undefined) {
      updateFields[allowedField] = body[allowedField];
    }
  });

  // Auth0 doesn't allow root fields (email, password, etc) to be updated
  // if the user signed up with a social provider (google, facebook, etc).
  // TODO: If you have a paid "Developer" plan you could use account linking and
  // link an email/pass account to the user to make these values changeable.
  const socialProviderId = user.uid.split("|")[0];
  if (socialProviderId !== "auth0") {
    // For now we just return an error that can be displayed within the UI.
    const fieldName = Object.keys(updateFields)[0];
    return res.send({
      status: "error",
      code: "auth/cannot-update-social-user",
      message: `You can only update ${fieldName} if you signed up with email/password`,
    });
  }

  // Throw error if token is older than MAX_TOKEN_AGE
  const tokenAgeSeconds = Date.now() / 1000 - user.iat;
  if (tokenAgeSeconds > MAX_TOKEN_AGE) {
    return res.send({
      status: "error",
      code: "auth/requires-recent-login",
      message: "Please login again to complete this action",
    });
  }

  return managementClient
    .updateUser({ id: user.uid }, updateFields)
    .then((updatedUser) => {
      res.send({ status: "success", data: updatedUser });
    })
    .catch((error) => {
      console.log("auth-user error", error);

      res.send({
        status: "error",
        code: error.code,
        message: error.message,
      });
    });
});
