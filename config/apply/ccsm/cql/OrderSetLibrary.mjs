export const OrderSetLibrary = {
   "library" : {
      "annotation" : [ {
         "translatorOptions" : "",
         "type" : "CqlToElmInfo"
      } ],
      "identifier" : {
         "id" : "OrderSetLibrary",
         "version" : "1.0.0"
      },
      "schemaIdentifier" : {
         "id" : "urn:hl7-org:elm",
         "version" : "r1"
      },
      "usings" : {
         "def" : [ {
            "localIdentifier" : "System",
            "uri" : "urn:hl7-org:elm-types:r1"
         }, {
            "localIdentifier" : "FHIR",
            "uri" : "http://hl7.org/fhir",
            "version" : "4.0.1"
         } ]
      },
      "includes" : {
         "def" : [ {
            "localIdentifier" : "FHIRHelpers",
            "path" : "FHIRHelpers",
            "version" : "4.0.1"
         } ]
      },
      "codeSystems" : {
         "def" : [ {
            "name" : "URN",
            "id" : "urn:com.epic.cdshooks.action.code.system.preference-list-item",
            "accessLevel" : "Public"
         } ]
      },
      "codes" : {
         "def" : [ {
            "name" : "Primary HPV",
            "id" : "82675-0",
            "display" : "82675-0",
            "accessLevel" : "Public",
            "codeSystem" : {
               "name" : "URN"
            }
         }, {
            "name" : "Cytology",
            "id" : "82675-0",
            "display" : "82675-0",
            "accessLevel" : "Public",
            "codeSystem" : {
               "name" : "URN"
            }
         }, {
            "name" : "Cotest",
            "id" : "82675-0",
            "display" : "82675-0",
            "accessLevel" : "Public",
            "codeSystem" : {
               "name" : "URN"
            }
         }, {
            "name" : "Colposcopy",
            "id" : "82675-0",
            "display" : "82675-0",
            "accessLevel" : "Public",
            "codeSystem" : {
               "name" : "URN"
            }
         }, {
            "name" : "Surveillance",
            "id" : "82675-0",
            "display" : "82675-0",
            "accessLevel" : "Public",
            "codeSystem" : {
               "name" : "URN"
            }
         }, {
            "name" : "Treatment",
            "id" : "82675-0",
            "display" : "82675-0",
            "accessLevel" : "Public",
            "codeSystem" : {
               "name" : "URN"
            }
         } ]
      },
      "statements" : {
         "def" : [ {
            "name" : "ToCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "type" : "FunctionDef",
            "expression" : {
               "type" : "Tuple",
               "element" : [ {
                  "name" : "coding",
                  "value" : {
                     "type" : "List",
                     "element" : [ {
                        "type" : "Tuple",
                        "element" : [ {
                           "name" : "system",
                           "value" : {
                              "path" : "system",
                              "type" : "Property",
                              "source" : {
                                 "name" : "code",
                                 "type" : "OperandRef"
                              }
                           }
                        }, {
                           "name" : "code",
                           "value" : {
                              "path" : "code",
                              "type" : "Property",
                              "source" : {
                                 "name" : "code",
                                 "type" : "OperandRef"
                              }
                           }
                        }, {
                           "name" : "display",
                           "value" : {
                              "path" : "display",
                              "type" : "Property",
                              "source" : {
                                 "name" : "code",
                                 "type" : "OperandRef"
                              }
                           }
                        } ]
                     } ]
                  }
               }, {
                  "name" : "display",
                  "value" : {
                     "path" : "display",
                     "type" : "Property",
                     "source" : {
                        "name" : "code",
                        "type" : "OperandRef"
                     }
                  }
               } ]
            },
            "operand" : [ {
               "name" : "code",
               "operandTypeSpecifier" : {
                  "name" : "{urn:hl7-org:elm-types:r1}Code",
                  "type" : "NamedTypeSpecifier"
               }
            } ]
         }, {
            "name" : "PrimaryHpvCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "expression" : {
               "name" : "ToCodeableConcept",
               "type" : "FunctionRef",
               "operand" : [ {
                  "name" : "Primary HPV",
                  "type" : "CodeRef"
               } ]
            }
         }, {
            "name" : "CytologyCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "expression" : {
               "name" : "ToCodeableConcept",
               "type" : "FunctionRef",
               "operand" : [ {
                  "name" : "Cytology",
                  "type" : "CodeRef"
               } ]
            }
         }, {
            "name" : "CotestCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "expression" : {
               "name" : "ToCodeableConcept",
               "type" : "FunctionRef",
               "operand" : [ {
                  "name" : "Cotest",
                  "type" : "CodeRef"
               } ]
            }
         }, {
            "name" : "ColposcopyCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "expression" : {
               "name" : "ToCodeableConcept",
               "type" : "FunctionRef",
               "operand" : [ {
                  "name" : "Colposcopy",
                  "type" : "CodeRef"
               } ]
            }
         }, {
            "name" : "SurveillanceCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "expression" : {
               "name" : "ToCodeableConcept",
               "type" : "FunctionRef",
               "operand" : [ {
                  "name" : "Surveillance",
                  "type" : "CodeRef"
               } ]
            }
         }, {
            "name" : "TreatmentCodeableConcept",
            "context" : "Patient",
            "accessLevel" : "Public",
            "expression" : {
               "name" : "ToCodeableConcept",
               "type" : "FunctionRef",
               "operand" : [ {
                  "name" : "Treatment",
                  "type" : "CodeRef"
               } ]
            }
         } ]
      }
   }
}