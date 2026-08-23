import * as assistant from '../services/siteAssistant.service.js';
import { syncIndex, indexStatus } from '../services/siteKnowledge.service.js';

// Website assistant endpoints. The chat route is public — the chatbot's main
// audience is a visitor on the landing page deciding whether to sign up, and
// requiring an account to ask what a plan costs defeats the point. It is rate
// limited in the router instead.

export async function chat(req, res, next) {
  try {
    const { question, message, history } = req.body ?? {};
    const result = await assistant.ask({
      // `message` is accepted as an alias so the widget's payload reads
      // naturally; `question` is the documented name.
      question: question ?? message,
      history,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function status(req, res, next) {
  try {
    res.json(await indexStatus());
  } catch (err) {
    next(err);
  }
}

export async function reindex(req, res, next) {
  try {
    // `force` re-embeds every chunk rather than only the changed ones. It
    // costs a full pass of the embedding quota, so it is opt-in: the default
    // is the same incremental sync that runs at boot.
    const summary = await syncIndex({ force: req.body?.force === true });
    res.json(summary);
  } catch (err) {
    next(err);
  }
}
