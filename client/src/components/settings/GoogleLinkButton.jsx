import React from 'react';
import GoogleSignInButton from '../auth/GoogleSignInButton';

/**
 * Link a Google identity using the same slide-to-confirm control as sign-in.
 * The server still verifies the Google email against this account's email.
 */
const GoogleLinkButton = ({ onLinked, onError }) => (
  <div className="google-link-wrap">
    <GoogleSignInButton
      mode="link"
      showDivider={false}
      unavailableMessage="Google sign-in is not configured on this server."
      onLinked={onLinked}
      onError={onError}
    />
  </div>
);

export default GoogleLinkButton;
