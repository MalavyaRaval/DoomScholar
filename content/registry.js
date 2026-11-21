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

/* Deep dives (long-form reading): registerDeepDive({...meta, sections?: [...]}) and/or
   deepSection(id, {...}) once per section, so a deep dive can be one file or a folder of files. */
window.DEEPDIVES = [];
function ddEntry(id) {
  let dd = window.DEEPDIVES.find((x) => x.id === id);
  if (!dd) { dd = { id, sections: [] }; window.DEEPDIVES.push(dd); }
  return dd;
}
window.registerDeepDive = function (meta) {
  const { sections, ...rest } = meta;
  const dd = ddEntry(meta.id);
  Object.assign(dd, rest);
  (sections || []).forEach((s) => dd.sections.push(s));
};
window.deepSection = function (id, section) { ddEntry(id).sections.push(section); };
