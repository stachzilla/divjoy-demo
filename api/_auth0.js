const Auth0 = require("auth0");
const JwksClient = require("jwks-rsa");
const jwt = require("jsonwebtoken");
const { promisify } = require("util");

// Management client for interacting with Auth0 API
const managementClient = new Auth0.ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
  clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
});

// Functions for decoding and verifying access tokens

const jwksClient = JwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

// Convert functions to promises
const jwtVerify = promisify(jwt.verify);
const getSigningKey = promisify(jwksClient.getSigningKey);
function jwtDecode(token) {
  return new Promise((resolve, reject) => {
    const decoded = jwt.decode(token, { complete: true });
    if (decoded) {
      resolve(decoded);
    } else {
      reject(new Error("Could not decode token"));
    }
  });
}

function verifyAccessToken(accessToken) {
  return jwtDecode(accessToken)
    .then((decoded) => {
      return getSigningKey(decoded.header.kid);
    })
    .then((key) => {
      const signingKey = key.getPublicKey();
      return jwtVerify(accessToken, signingKey, {
        algorithms: ["RS256"],
        audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      });
    });
}

module.exports = {
  managementClient,
  verifyAccessToken,
};
