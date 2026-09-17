# Company detail performance baseline

The company detail endpoint now exposes non-sensitive timing metadata so a
staging run can identify whether database fan-out, response size, or browser
rendering is the limiting layer.

## Server metrics

`GET /api/businesses/:id` returns:

- `Server-Timing: db;dur=…`: sum of the individual D1 query durations.
- `Server-Timing: related;dur=…`: wall-clock duration of the parallel related
  query group.
- `Server-Timing: total;dur=…`: total server duration for the endpoint.
- `X-Hidaca-Payload-Bytes`: uncompressed JSON payload size in bytes.

The endpoint remains private and `no-store`; the headers contain timing and
size only, never CRM values.

## Browser milestones

The RecordWorkspace client records Performance Timeline entries named:

- `hidaca:record-workspace:business:request`: fetch plus JSON parsing time.
- `hidaca:record-workspace:business:render`: data-ready to the first rendered
  workspace effect.

Contact detail uses the corresponding `contact` names. The data-ready mark
also carries the server timing and payload-size headers in its `detail` value.

For a baseline run, open the same synthetic record cold and warm at desktop,
tablet, and mobile widths, then inspect the Network response headers and run:

```js
performance.getEntriesByName("hidaca:record-workspace:business:request");
performance.getEntriesByName("hidaca:record-workspace:business:render");
```

Capture server timing, payload bytes, browser milestones, and viewport for
each run before changing query shape or rendering behavior.
