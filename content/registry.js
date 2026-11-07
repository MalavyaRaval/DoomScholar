/* Every file in content/ calls one of these. See CONTENT_GUIDE.md for the formats. */
window.TOPICS = [];
window.registerTopic = function (topic) { window.TOPICS.push(topic); };

/* Mock interviews: one registerInterview({...meta}) plus one interviewPhase(id, {...}) per phase file. */
window.INTERVIEWS = [];
function ivEntry(id) {
  let iv = window.INTERVIEWS.find((x) => x.id === id);
  if (!iv) { iv = { id, phases: [] }; window.INTERVIEWS.push(iv); }
  return iv;
}
window.registerInterview = function (meta) { Object.assign(ivEntry(meta.id), meta); };
window.interviewPhase = function (id, phase) { ivEntry(id).phases.push(phase); };
