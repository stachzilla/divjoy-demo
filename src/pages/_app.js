import React from "react";
import Navbar from "./../components/Navbar";
import IndexPage from "./index";
import FaqPage from "./faq";
import PricingPage from "./pricing";
import ContactPage from "./contact";
import DashboardPage from "./dashboard";
import SettingsPage from "./settings";
import PurchasePage from "./purchase";
import AuthPage from "./auth";
import { Switch, Route, Router } from "./../util/router.js";
import Auth0Callback from "./auth0-callback.js";
import NotFoundPage from "./not-found.js";
import Footer from "./../components/Footer";
import "./../util/analytics.js";
import { AuthProvider } from "./../util/auth.js";
import { ThemeProvider } from "./../util/theme.js";

function App(props) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <>
            <Navbar
              color="default"
              logo="https://uploads.divjoy.com/logo.svg"
              logoInverted="https://uploads.divjoy.com/logo-white.svg"
            />

            <Switch>
              <Route exact path="/" component={IndexPage} />

              <Route exact path="/faq" component={FaqPage} />

              <Route exact path="/pricing" component={PricingPage} />

              <Route exact path="/contact" component={ContactPage} />

              <Route exact path="/dashboard" component={DashboardPage} />

              <Route exact path="/settings/:section" component={SettingsPage} />

              <Route exact path="/purchase/:plan" component={PurchasePage} />

              <Route exact path="/auth/:type" component={AuthPage} />

              <Route exact path="/auth0-callback" component={Auth0Callback} />

              <Route component={NotFoundPage} />
            </Switch>

            <Footer
              bgColor="light"
              size="normal"
              bgImage=""
              bgImageOpacity={1}
              description="A short description of what you do here"
              copyright="© 2020 Company"
              logo="https://uploads.divjoy.com/logo.svg"
              logoInverted="https://uploads.divjoy.com/logo-white.svg"
              sticky={true}
            />
          </>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
