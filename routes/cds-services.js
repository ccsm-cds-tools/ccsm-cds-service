// Portions of this file are based on the original [CQL Services](https://github.com/AHRQ-CDS/AHRQ-CDS-Connect-CQL-SERVICES) 
// developed for the [CDS Connect](https://cds.ahrq.gov/cdsconnect) project, sponsored by the 
// [Agency for Healthcare Research and Quality](https://www.ahrq.gov/) (AHRQ), and developed under contract with AHRQ by 
// [MITRE's Health FFRDC](https://www.mitre.org/our-impact/rd-centers/health-ffrdc).
// Copyright 2016-2018 Agency for Healthcare Research and Quality.
// Licensed under the Apache License, Version 2.0 (the "License").
'use strict';
import { env } from 'process';
import { Router } from 'express';
const router = Router();
import { Executor } from 'cql-execution';
import { PatientSource } from 'cql-exec-fhir';
import fhirclient from 'fhirclient';
import cloneDeep from 'lodash/cloneDeep.js';
import isPlainObject from 'lodash/isPlainObject.js';
import { simpleResolver, applyAndMerge } from 'encender';
import { get } from '../lib/code-service-loader.js';
import hooksLoader from '../lib/hooks-loader.js';
import { get as _get } from '../lib/libraries-loader.js';
import { get as getAppliable } from '../lib/apply-loader.js';

/* eslint-disable no-console */

// Middleware to setup response headers with CORS
router.use((request, response, next) => {
  response.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Origin, Accept, Content-Location, Location, X-Requested-With',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json; charset=utf-8',
  });
  next();
});

// Establish the routes
router.get('/', discover);
router.post('/:id', resolver, valuesetter, call);

/**
 * Route handler that returns the list of available CDS services.
 * @see {@link https://cds-hooks.hl7.org/1.0/#discovery}
 */
function discover(req, res, next) {
  res.json({
    services: hooksLoader.get().all(true)
  });
}

/**
 * Middleware to confirm and load hook and library from URL.
 * Puts resulting hook definition and library in `res.locals`.
 */
function resolver(req, res, next) {
  // Check to ensure required properties are present
  if (!req.body.hook || !req.body.hookInstance || !req.body.context) {
    sendError(res, 400, 'Invalid request. Missing at least one required field from: hook, hookInstance, context.');
    return;
  }

  // Load the service definition
  const hook = hooksLoader.get().find(req.params.id);
  if (!hook) {
    logError(`Hook not found: ${req.params.id}`);
    res.sendStatus(404);
    return;
  }
  res.locals.hook = hook;

  // Ensure the hook definition specifies either a CQL library or a PlanDefinition
  if ( (hook?._config?.cql?.library?.id || hook?._config?.apply?.planDefinition) === false ) {
    sendError(res, 500, 'CDS Hook config does not specificy a CQL library or a PlanDefinition to $apply.');
    return;
  }

  if (hook._config.apply) {
    // Load the definitions needed for the $apply operation
    res.locals.apply = getAppliable()[hook._config.apply.key];
  } else {
    // Load the library
    let lib;
    if (typeof hook._config.cql.library.version === 'undefined') {
      lib = _get().resolveLatest(hook._config.cql.library.id);
    } else {
      lib = _get().resolve(hook._config.cql.library.id, hook._config.cql.library.version);
    }

    if (typeof lib === 'undefined') {
      logError(`Library not found: ${hook._config.cql.library.id} v${hook._config.cql.library.version}`);
      // Set the 500 status and halt the request chain now
      sendError(res, 500, 'CDS Hook config specified a CQL library, but library could not be located.');
      return;
    } else {
      // Set the library in the res.locals for use by other middleware and/or routes
      res.locals.library = lib;
    }
  }

  // Invoke the next middleware/route in the chain
  next();
}

/**
 * Route handler that reads the valuesets needed by the requested
 * library and cross-checks with the local code service cache. If
 * no local version of a valueset is found, it is downloaded from
 * the Value Set Authority Center (VSAC). Requires 'resolver' handler
 * to proceed it in the handler chain.
 */
function valuesetter(req, res, next) {
  // Get the lib from the res.locals (thanks, middleware!)
  const library = res.locals?.library;

  if (library) {
    // If the calling library has valuesets, crosscheck them with the local
    // codeservice. Any valuesets not found in the local cache will be
    // downloaded from VSAC.
    // Use of API Key is preferred, as username/password will not be supported on Jan 1 2021
    const ensureValueSets = env['UMLS_USER_NAME'] && !env['UMLS_API_KEY']
      ? get().ensureValueSetsInLibrary(library)
      : get().ensureValueSetsInLibraryWithAPIKey(library);
    ensureValueSets.then(() => next())
      .catch((err) => {
        logError(err);
        if (req.app.locals.ignoreVSACErrors) {
          next();
        } else {
          let errToSend = err;
          if (err instanceof Error) {
            errToSend = err.message;
          } else if (Array.isArray(err)) {
            errToSend = err.map(e => e instanceof Error ? e.message : e);
          }
          sendError(res, 500, errToSend, false);
        }
      });
  } else {
    next();
  }
}

/**
 * Route handler that handles a service call.
 * @see {@link https://cds-hooks.org/specification/1.0/#calling-a-cds-service|Calling a CDS Service}
 */
async function call(req, res, next) {
  const hook = res.locals.hook;
  if (res.locals.apply) { hook.prefetch = res.locals.apply.prefetch; }

  console.log();
  console.log('==================================================');
  console.log('Received call for %s hook', hook?.title);

  // Clean prefetch before logging
  let body = cloneDeep(req?.body);
  Object.entries(req?.body?.prefetch ?? {}).forEach(([key,value]) => {
    if (value?.resourceType !== 'Bundle') {
      body.prefetch[key] = {
        id: value.id,
        resourceType: value.resourceType
      };
    }
  });

  // console.log('--------------------------------------------------');
  // console.log('Request body:');
  // console.log(body);

  // Build up a single bundle representing all data
  const bundle = {
    resourceType: 'Bundle',
    type: 'collection',
    entry: []
  };
  // console.log(hook);
  // console.log(req);
  // console.log(res);
  if (hook.prefetch) {
    // Create a FHIR client in case we need to call out to the FHIR server
    const client = getFHIRClient(req, res);
    let searchRequests = [];
    // Iterate through the prefetch keys to determine if they are supplied or if we need to query for the data
    for (const key of Object.keys(hook.prefetch)) {
      const pf = req.body.prefetch[key];
      if (typeof pf === 'undefined' && req.app.locals.smartIfNoPrefetch) {
        // The prefetch was not provided, so use the FHIR client (if available) to request the data
        if (client == null) {
          res.sendStatus(412);
          return;
        }
        let searchURL = hook.prefetch[key];
        // Replace the context placeholders in the queries
        Object.keys(req.body.context || {}).forEach(contextKey => {
          searchURL = searchURL.split(`{{context.${contextKey}}}`).join(req.body.context[contextKey]);
        });
        // Perform the search and add the response to the bundle
        const searchRequest = client.request(searchURL, { pageLimit: 0, flat: true })
          .then(result => addResponseToBundle(result, bundle));
        // Push the promise onto the array so we can await it later
        searchRequests.push(searchRequest);
      } else {
        // The prefetch was supplied so just add it directly to the bundle
        addResponseToBundle(pf, bundle);
      }
    }
    // Wait for any open requests to finish, returning if there is an error
    try {
      await Promise.all(searchRequests);
    } catch(err) {
      res.sendStatus(412);
      return;
    }
  }

  // Alternative to FHIR queries can also be included via the ALT_FHIR_QUERIES env parameter
  // (which maps to req.app.locals.altFhirQueries).
  if (req.app.locals.altFhirQueries?.length > 0) {
    const client = getFHIRClient(req, res);
    let searchRequests = [];
    req.app.locals.altFhirQueries.forEach(afq => {
      console.log('URL template: ', afq);
      const { translateResponse } = res.locals?.apply ? res.locals.apply : { translateResponse(input, _data) { return input; } };
      let searchURL = afq;
      // Replace the context placeholders in the queries
      Object.keys(req.body.context || {}).forEach(contextKey => {
        searchURL = searchURL.split(`{{context.${contextKey}}}`).join(req.body.context[contextKey]);
      });
      // Fallback to using the Patient resource to fill in the patientId if one isn't provided as context
      let patientId = null;
      const patients = bundle.entry.filter(b => b.resource.resourceType === 'Patient');
      if (patients.length > 0) { patientId = patients[0].resource.id; }
      if (patientId) { searchURL = searchURL.split('{{context.patientId}}').join(patientId); }
      console.log('Request context: ', req.body.context);
      console.log('searchURL ', searchURL);
      const searchRequest = client.request(searchURL, { pageLimit: 0, flat: true })
        .then(result => {
          let patientData = bundle.entry.map(b => b.resource);
          let translated = translateResponse(result, patientData);
          bundle.entry = translated.map(tr => ({ resource: tr }));
        });
      searchRequests.push(searchRequest);
    });
    try {
      await Promise.all(searchRequests);
    } catch (err) {
      res.sendStatus(412);
      return;
    }
  }

  console.log('--------------------------------------------------');
  console.log('Bundle going into CDS:');
  bundle.entry.forEach(ent => {
    const rt = ent.resource?.resourceType ?? '*** no resource type ***';
    const rid = ent.resource?.id ?? '*** no resource id ***';
    console.log(' -', rt, rid);
  });

  let cards = [];
  if (res.locals?.apply) { // $apply a PlanDefinition

    // Gather resources
    let patientData = bundle.entry.map(b => b.resource);

    // MODIFY PATIENT DATA HERE
    const idsToExclude = [
      '14753', // Hysterecomy procedure
      '14802', // Colposcopy procedure
      '14803', // Excision procedure
      '14754', // Cytopath Diagnostic Report (no relevant codes)
      '14852', // Biopsy Observation - with result
      // '14755', // Biopsy DR
    ];

    // Remove extraneous resources
    // patientData = patientData.filter(resource => !idsToExclude.includes(resource.id));

    // Remove extraneous codes
    // patientData.map((resource) => {
    //   if (resource.id === '14755') {
    //     resource.code.coding = resource.code.coding[0];
    //   }
    //   return resource;
    // });

    // patientData.forEach((resource) => {
    //   if (resource.id === '14755') {
    //     let singleCode = resource.code.coding[0];
    //     resource.code.coding = singleCode;
    //   }
    // });
    patientData =
      [
        {
          "resourceType": "Patient",
          "id": "14752",
          "meta": {
            "versionId": "2",
            "lastUpdated": "2023-08-01T19:22:09.000+00:00",
            "source": "#gyCmEFrjz5sLpw4a"
          },
          "text": {
            "status": "generated",
            "div": "<div xmlns=\"http://www.w3.org/1999/xhtml\"><div class=\"hapiHeaderText\">Fiftythree <b>MITRE </b></div><table class=\"hapiPropertyTable\"><tbody><tr><td>Identifier</td><td>PGHJRLT7V89SBGH</td></tr><tr><td>Address</td><td><span>2811 Front Street North </span><br/><span>HOUSTON </span><span>PA </span></td></tr><tr><td>Date of birth</td><td><span>19 August 1980</span></td></tr></tbody></table></div>"
          },
          "extension": [
            {
              "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
              "extension": [
                {
                  "url": "ombCategory",
                  "valueCoding": {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
                    "code": "UNK",
                    "display": "Unknown"
                  }
                },
                {
                  "url": "text",
                  "valueString": "Unknown"
                }
              ]
            },
            {
              "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity",
              "extension": [
                {
                  "url": "text",
                  "valueString": "Unknown"
                }
              ]
            },
            {
              "url": "http://open.epic.com/FHIR/StructureDefinition/extension/legal-sex",
              "valueCodeableConcept": {
                "coding": [
                  {
                    "system": "urn:oid:1.2.840.114350.1.13.88.3.7.10.698084.130.657370.2199",
                    "code": "female",
                    "display": "female"
                  }
                ]
              }
            },
            {
              "url": "http://open.epic.com/FHIR/StructureDefinition/extension/sex-for-clinical-use",
              "valueCodeableConcept": {
                "coding": [
                  {
                    "system": "urn:oid:1.2.840.114350.1.13.88.3.7.10.698084.130.657370.2199",
                    "code": "female",
                    "display": "female"
                  }
                ]
              }
            },
            {
              "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex",
              "valueCode": "F"
            }
          ],
          "identifier": [
            {
              "use": "usual",
              "type": {
                "text": "CEID"
              },
              "system": "urn:oid:1.2.840.114350.1.13.88.3.7.3.688884.100",
              "value": "PGHJRLT7V89SBGH"
            },
            {
              "use": "usual",
              "type": {
                "text": "EPIC"
              },
              "system": "urn:oid:2.16.840.1.113883.3.552.1.3.11.13.1.8.2",
              "value": "741498901"
            },
            {
              "use": "usual",
              "type": {
                "text": "EXTERNAL"
              },
              "system": "urn:oid:1.2.840.114350.1.13.88.3.7.2.698084",
              "value": "691489956"
            },
            {
              "use": "usual",
              "type": {
                "text": "FHIR"
              },
              "system": "http://open.epic.com/FHIR/StructureDefinition/patient-dstu2-fhir-id",
              "value": "TFIjvnQFjFQrsaMKZxSXWwL8YYAsjbwha8gt8wJ86xgsB"
            },
            {
              "use": "usual",
              "type": {
                "text": "FHIR STU3"
              },
              "system": "http://open.epic.com/FHIR/StructureDefinition/patient-fhir-id",
              "value": "eq54QN5KW0-Nh9A6sVMZ-ytxkYDmEbaKo5Am3HWTeUkw3"
            },
            {
              "use": "usual",
              "type": {
                "text": "INTERNAL"
              },
              "system": "urn:oid:1.2.840.114350.1.13.88.3.7.2.698084",
              "value": " 691489956"
            },
            {
              "use": "usual",
              "type": {
                "text": "UPM"
              },
              "system": "urn:oid:2.16.840.1.113883.3.552.1.3.11.11.1.8.2",
              "value": "100002218"
            },
            {
              "use": "old",
              "value": "eq54QN5KW0-Nh9A6sVMZ-ytxkYDmEbaKo5Am3HWTeUkw3"
            }
          ],
          "active": true,
          "name": [
            {
              "use": "official",
              "text": "Fiftythree Mitre",
              "family": "Mitre",
              "given": [
                "Fiftythree"
              ]
            },
            {
              "use": "usual",
              "text": "Fiftythree Mitre",
              "family": "Mitre",
              "given": [
                "Fiftythree"
              ]
            }
          ],
          "telecom": [
            {
              "system": "phone",
              "value": "412-555-5858",
              "use": "home"
            },
            {
              "system": "phone",
              "value": "412-555-5756",
              "use": "work"
            },
            {
              "system": "email",
              "value": "none@upmc.edu",
              "rank": 1
            }
          ],
          "gender": "female",
          "birthDate": "1980-08-19",
          "deceasedBoolean": false,
          "address": [
            {
              "use": "old",
              "line": [
                "2811 Front Street North"
              ],
              "city": "HOUSTON",
              "state": "PA",
              "postalCode": "15342"
            },
            {
              "use": "home",
              "line": [
                "2811 Front Street North"
              ],
              "city": "HOUSTON",
              "state": "PA",
              "postalCode": "15342"
            }
          ],
          "managingOrganization": {
            "display": "UNIV OF PITTSBURGH PHYSICIANS"
          }
        },
        {
          "resourceType": "Observation",
          "id": "14852",
          "meta": {
            "versionId": "3",
            "lastUpdated": "2023-08-15T07:02:53.000+00:00",
            "source": "#hAy9C3jG5xHEnb2a"
          },
          "status": "final",
          "category": [
            {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                  "code": "laboratory"
                }
              ]
            }
          ],
          "code": {
            "coding": [
              {
                "system": "http://loinc.org",
                "code": "65753-6",
                "display": "Cervix Pathology biopsy report"
              }
            ]
          },
          "subject": {
            "reference": "Patient/14752"
          },
          "effectiveDateTime": "2018-09-30T04:00:00Z",
          "valueCodeableConcept": {
            "coding": [
              {
                "system": "http://snomed.info/sct",
                "code": "165324008",
                "display": "Biopsy result normal (finding)"
              }
            ]
          }
        },
        {
          "resourceType": "DiagnosticReport",
          "id": "14755",
          "meta": {
            "versionId": "2",
            "lastUpdated": "2023-08-15T05:27:56.000+00:00",
            "source": "#D43v12kUxcFyjRlp"
          },
          "text": {
            "status": "generated",
            "div": "<div xmlns=\"http://www.w3.org/1999/xhtml\"><div class=\"hapiHeaderText\"> GYNECOLOGICAL PATHOLOGY REPORT, TISSUE </div><table class=\"hapiPropertyTable\"><tbody><tr><td>Status</td><td>FINAL</td></tr><tr><td>Issued</td><td> 30 September 2018 04:00:00 </td></tr></tbody></table></div>"
          },
          "identifier": [
            {
              "use": "official",
              "type": {
                "coding": [
                  {
                    "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                    "code": "PLAC",
                    "display": "Placer Identifier"
                  }
                ],
                "text": "Placer Identifier"
              },
              "system": "urn:oid:1.2.840.114350.1.13.88.3.7.2.798268",
              "value": "378231469"
            },
            {
              "use": "old",
              "value": "egBb46SeRCf9GhkcEIiAjrhx-ovQ8Lx9Pe1IcihFdg3U3"
            }
          ],
          "status": "final",
          "category": [
            {
              "coding": [
                {
                  "system": "urn:oid:1.2.840.114350.1.13.88.3.7.10.798268.30",
                  "code": "CYTOPATH"
                }
              ],
              "text": "Cytopathology"
            },
            {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                  "code": "LAB",
                  "display": "Laboratory"
                }
              ],
              "text": "Laboratory"
            }
          ],
          "code": {
            "coding": [
              {
                "system": "http://loinc.org",
                "code": "65753-6",
                "display": "Cervix Pathology biopsy report"
              }//,
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.116",
              //   "code": "78551"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.3000",
              //   "code": "191189"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.3090",
              //   "code": "GYN FINAL REPORT"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.157",
              //   "code": "2890018"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.2011",
              //   "code": "14516X"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.2016",
              //   "code": "14516"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.16",
              //   "code": "CP0141"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.3001",
              //   "code": "191189"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.2100",
              //   "code": "14516"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.196",
              //   "code": "4900020OI"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.2200",
              //   "code": "14516"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.2300",
              //   "code": "14516"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.196",
              //   "code": "OGHGYN"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.196",
              //   "code": "4900009O"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.196",
              //   "code": "UTERUS"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.594",
              //   "code": "GYN"
              // },
              // {
              //   "system": "urn:oid:1.2.840.114350.1.13.88.3.7.5.737384.594",
              //   "code": "PTHGYN"
              // }
            ],
            "text": "GYNECOLOGICAL PATHOLOGY REPORT, TISSUE"
          },
          "subject": {
            "reference": "Patient/14752",
            "display": "Mitre, Fiftythree"
          },
          "encounter": {
            "identifier": {
              "use": "usual",
              "system": "urn:oid:1.2.840.114350.1.13.88.3.7.3.698084.8",
              "value": "2590100137883"
            },
            "display": "Appointment"
          },
          "effectiveDateTime": "2018-09-30T04:00:00Z",
          "issued": "2018-09-30T04:00:00Z",
          "performer": [
            {
              "display": "Historical Provider"
            },
            {
              "display": "COPATH"
            }
          ]
        }
      ];


    console.log('PATIENT DATA');
    console.log(JSON.stringify(patientData, null, 4));
    // console.dir(patientData);

    const { elmJson, cdsResources, valueSetJson, formatCards, collapseIntoOne } = res.locals.apply;
    let resolver = simpleResolver([...cdsResources, ...patientData], true);
    const planDefinition = resolver('PlanDefinition/' + hook._config.apply.planDefinition)[0];
    const patientReference = 'Patient/' + patientData.filter(pd => pd.resourceType === 'Patient').map(pd => pd.id)[0];

    // Run Encender applyAndMerge() operation
    const aux = {
      elmJsonDependencies: elmJson,
      valueSetJson
    };
    const [RequestGroup, ...otherResources] = await applyAndMerge(planDefinition, patientReference, resolver, aux);

    console.log('REQUEST GROUP: ', RequestGroup);
    console.log('OTHER RESOURCES: ', otherResources);
    // If RequestGroup has actions, convert them to properly-formatted CDS Hooks cards
    if (RequestGroup?.action) {
      console.log('REQUEST GROUP HAS ACTIONS');
      // Pass action array into extractCards recursive function
      let newCards = formatCards(RequestGroup.action, otherResources).flat();
      console.log('NEW CARDS: ', newCards);
      cards.push(...newCards);
    }

    if (res.app.locals.collapseCards) {
      cards = collapseIntoOne(cards, req.app.locals.useHtml ?? false);
    }

    console.log('--------------------------------------------------');
    console.log('Cards returned from CDS:');
    console.log(cards);

    console.log('--------------------------------------------------');
    console.log('Suggestions:');
    cards.forEach(card => {
      console.log(JSON.stringify(card.suggestions, null, 2));
    });
    console.log();

  } else { // Evaluate CQL expressions (not tied to any PlanDefinition)

    // Get the lib from the res.locals (thanks, middleware!)
    const lib = res.locals.library;

    // Load the patient source
    let patientSource;
    const usingFHIR = lib.source.library.usings.def.find(d => d.url == 'http://hl7.org/fhir' || d.localIdentifier == 'FHIR');
    switch (usingFHIR.version) {
      case '1.0.2': patientSource = PatientSource.FHIRv102(); break;
      case '3.0.0': patientSource = PatientSource.FHIRv300(); break;
      case '4.0.0': patientSource = PatientSource.FHIRv400(); break;
      case '4.0.1': patientSource = PatientSource.FHIRv401(); break;
      default:
        logError(`Library does not use any supported data models: ${lib.source.library.usings.def}`);
        sendError(res, 501, `Not Implemented: Unsupported data model (must be FHIR 1.0.2, 3.0.0, 4.0.0, or 4.0.1`);
        return;
    }

    // Load the data into the patient source
    patientSource.loadBundles([bundle]);

    // Execute it and send the results
    let results;
    try {
      const executor = new Executor(lib, get());
      results = executor.exec(patientSource);
    } catch (err) {
      logError(err);
      let errToSend = err;
      let responseCode = 500;
      if (err instanceof Error) {
        errToSend = err.message;
        // If it's an invalid UCUM unit or other invalid value, send 422 response code instead
        // of 500. Ideally this would be a more specific error type we could catch, but it isn't;
        // so detect it via a simple string match for the word 'invalid' or 'UCUM' for now.
        if (errToSend.indexOf('invalid') !== -1 || errToSend.indexOf('UCUM') !== -1) {
          responseCode = 422;
        }
      } else if (Array.isArray(err)) {
        errToSend = err.map(e => e instanceof Error ? e.message : e);
      }
      sendError(res, responseCode, errToSend, false);
    }

    const resultIDs = Object.keys(results.patientResults);
    if (resultIDs.length == 0) {
      sendError(res, 400, 'Insufficient data to provide results.');
      return;
    } else if (resultIDs.length > 1) {
      sendError(res, 400, 'Data contained information about more than one patient.');
      return;
    }
    const pid = resultIDs[0];
    const pResults = results.patientResults[pid];

    // Get the cards from the config and replace the ${...} expressions
    for (let i = 0; i < hook._config.cards.length; i++) {
      const cardCfg = cloneDeep(hook._config.cards[i]);

      // Check the condition
      if (cardCfg.conditionExpression != null) {
        const hasConditionExpression = Object.prototype.hasOwnProperty.call(pResults, cardCfg.conditionExpression.split('.')[0]);
        if (!hasConditionExpression) {
          sendError(res, 500, 'Hook configuration refers to non-existent conditionExpression');
          return;
        }
        const condition = resolveExp(pResults, cardCfg.conditionExpression);
        if (!condition) {
          continue;
        }
      }
      const card = interpolateVariables(cardCfg.card, pResults);

      // If there are errors or warnings, report them as extensions
      const report = (label, items) => {
        if (items == null || items.length === 0) {
          return;
        } else if (!Array.isArray(items)) {
          items = [items];
        }
        card.extension = card.extension || {};
        card.extension[label] = items;
      };
      report('errors', pResults['Errors']);
      report('warnings', pResults['Warnings']);

      cards.push(card);
    }
  }

  res.json({
    cards
  });
}

function getFHIRClient(req, res) {
  console.log('req body:', req.body);
  if (req.body.fhirServer) {
    const state = {
      serverUrl: req.body.fhirServer,
    };
    if (req.body.fhirAuthorization) {
      const auth = req.body.fhirAuthorization;
      Object.assign(state, {
        clientId: auth.subject,
        scope: auth.scope,
        tokenResponse: {
          token_type: auth.token_type,
          scope: auth.scope,
          client_id: auth.subject,
          expires_in: auth.expires_in,
          access_token: auth.access_token
        }
      });
    }
    return fhirclient(req, res).client(state);
  }
}

function addResponseToBundle(response, bundle) {
  if (response == null) {
    // no results, do nothing
  } else if (Array.isArray(response)) {
    response.forEach(resource => {
      bundle.entry.push({ resource });
    });
  } else if (response.resourceType === 'Bundle' && response.type === 'searchset') {
    if (response.entry && response.entry.length > 0) {
      response.entry.forEach(entry => {
        if (entry != null && entry.resource != null) {
          bundle.entry.push({ resource: entry.resource });
        }
      });
    }
  } else {
    bundle.entry.push({ resource: response });
  }
}

function interpolateVariables(arg, results) {
  if (typeof arg === 'string') {
    // Look for embedded variables of form ${myVar}
    const matches = arg.match(/\$\{[^}]+\}/g);
    if (matches) {
      for (const m of matches) {
        // Get the variable name and then the result of the variable from execution
        const exp = /^\$\{(.+)\}$/.exec(m);
        const expVal = resolveExp(results, exp[1]);
        if (m === arg) {
          // The value contains *only* the expression variable, so replace it with the proper typed result
          // e.g., "${InPopulation}" should be replaced with true, not "true"
          return expVal;
        }
        // Otherwise, the value is embedded in a string, so replace it within the string
        // e.g., "The result is ${result}"
        arg = arg.replace(`\${${exp[1]}}`, expVal);
      }
    }
    return arg;
  } else if (Array.isArray(arg)) {
    // It's an array, so interpolate each item in the array
    return arg.map(a => interpolateVariables(a, results));
  } else if (isPlainObject(arg)) {
    // It's a plain object so interpolate the value of each key
    for (const key of Object.keys(arg)) {
      arg[key] = interpolateVariables(arg[key], results);
    }
    return arg;
  }
  // Whatever it is, just pass it through
  return arg;
}

function resolveExp(result, expr) {
  const parts = expr.split('.');
  for (const part of parts) {
    if (result == null) {
      break;
    }
    result = result[part];
  }
  return result == null ? '' : result;
}

function sendError(res, code, message, logIt = true) {
  if (logIt) {
    logError(message);
  }
  res.type('text/plain');
  res.status(code).send(message);
}

function logError(err) {
  if (Array.isArray(err)) {
    for (const e of err) {
      logError(e);
    }
    return;
  }
  const errString = err instanceof Error ? `${err.message}\n  ${err.stack}` : `${err}`;
  console.error((new Date()).toISOString(), 'ERROR:', errString);
}



export default router;
