# Coach visuals are self-contained sandboxed HTML without network

The coach can answer with a visual: a whole HTML document it writes, numbers included, shown inline in the coach chat in an `<iframe sandbox="allow-scripts">` whose content security policy blocks every request. VO2 injects the app's theme as CSS variables and sizes the frame to its content. There is no chart library inside the frame; the coach draws with SVG, HTML, CSS, and plain JavaScript.

The frame has no network because visuals are saved with the coach chat and reopened offline (ADR 0031), and a page the model wrote that could make requests could send the athlete's data anywhere if text in an activity steered the model. T3 Code, which inspired the feature, lets its pages load remote libraries; VO2 gives that up.

The coach types the numbers into the page itself, so every point passes through the model. To keep visuals quick, the stream tool returns at most about 150 points per channel, and the coach charts summaries such as splits, zones, and weekly load before raw streams. The tools still do the arithmetic; the model only copies numbers it was given.

## Considered options

- **Data requests:** the coach names the data a visual needs and the server fills it into the frame. That is faster for long streams and can't misquote a number, but it adds machinery a first version doesn't need. It is the next step if visuals turn out slow.
- **A chart spec drawn by the app's own charts:** every visual would match the app, but the coach could only show the chart types VO2 builds.
- **A bundled chart library injected into every frame:** ready-made axes and tooltips, at the cost of shipping and maintaining it. Worth adding if hand-drawn charts look weak.
