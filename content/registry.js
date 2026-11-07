/* Every file in content/ calls registerTopic({...}). See CONTENT_GUIDE.md for the format. */
window.TOPICS = [];
window.registerTopic = function (topic) { window.TOPICS.push(topic); };
