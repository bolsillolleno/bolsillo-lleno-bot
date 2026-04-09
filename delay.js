exports.humanDelay = (min, max) => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
};

exports.typingSimulation = async (sock, jid, duration = 2000) => {
  await sock.presenceSubscribe(jid);
  await sock.sendPresenceUpdate('composing', jid);
  await new Promise(r => setTimeout(r, duration));
  await sock.sendPresenceUpdate('paused', jid);
};
