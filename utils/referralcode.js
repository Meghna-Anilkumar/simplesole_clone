function generateReferralCode() {
  let referral = '';
  const characters = '0123456789';

  for (let i = 0; i < 6; i++) {
      referral += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return referral;
}


  module.exports={
    generateReferralCode
  }