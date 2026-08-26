import type { EppiTableColumnDefinition, EppiTableDefinition } from '../../domain';
import { createCapturedPage, createTableDefinition, type CapturedTableRow } from './shared';
import type { EppiCapturedPagination } from '../../domain';

const userColumns = [
    {
        "id": "user",
        "label": "Usuario",
        "widthPercent": 22
    },
    {
        "id": "role",
        "label": "Rol",
        "widthPercent": 15
    },
    {
        "id": "contact",
        "label": "Contacto",
        "widthPercent": 14
    },
    {
        "id": "dni",
        "label": "DNI",
        "widthPercent": 13
    },
    {
        "id": "employeeId",
        "label": "Legajo",
        "widthPercent": 12
    },
    {
        "id": "sector",
        "label": "Sector",
        "widthPercent": 12
    },
    {
        "id": "status",
        "label": "Estado",
        "widthPercent": 12,
        "status": true
    }
] as const satisfies readonly EppiTableColumnDefinition[];
const clientColumns = [
    {
        "id": "company",
        "label": "Empresa",
        "widthPercent": 14
    },
    {
        "id": "phone",
        "label": "Teléfono",
        "widthPercent": 13
    },
    {
        "id": "address",
        "label": "Dirección",
        "widthPercent": 29
    },
    {
        "id": "location",
        "label": "Localidad",
        "widthPercent": 11
    },
    {
        "id": "province",
        "label": "Provincia",
        "widthPercent": 11
    },
    {
        "id": "country",
        "label": "País",
        "widthPercent": 10
    },
    {
        "id": "contacts",
        "label": "Contactos",
        "widthPercent": 12
    }
] as const satisfies readonly EppiTableColumnDefinition[];
const productColumns = [
    {
        "id": "name",
        "label": "Nombre",
        "widthPercent": 24
    },
    {
        "id": "client",
        "label": "Cliente",
        "widthPercent": 18
    },
    {
        "id": "form",
        "label": "Forma farmacéutica",
        "widthPercent": 23
    },
    {
        "id": "dose",
        "label": "Dosis",
        "widthPercent": 10
    },
    {
        "id": "unit",
        "label": "Unidad",
        "widthPercent": 12
    },
    {
        "id": "code",
        "label": "Código",
        "widthPercent": 13
    }
] as const satisfies readonly EppiTableColumnDefinition[];

// Provenance: ui-audit-structural/screens/006-usuarios.json
export const userPageOneRows = [
    [
        "Adrian Hugo Martinez",
        "Operador",
        "",
        "23537419",
        "99",
        "",
        "Activo"
    ],
    [
        "Adrian Omar Franchi",
        "Gerente",
        "",
        "17587897",
        "16",
        "",
        "Activo"
    ],
    [
        "Agustina Fernanda Robledo",
        "Asistente",
        "",
        "43382936",
        "193",
        "Calidad",
        "Activo"
    ],
    [
        "Alexis Esteban Diaz",
        "Jefe",
        "",
        "36172172",
        "262",
        "Calidad",
        "Activo"
    ],
    [
        "Andrea Melina Gigena",
        "Control en proceso",
        "",
        "38370889",
        "157",
        "Producción",
        "Activo"
    ],
    [
        "Arian Martinez",
        "Asistente",
        "1171792025",
        "43599004",
        "284",
        "Calidad",
        "Activo"
    ],
    [
        "Aurora Celeste Oses",
        "Asistente",
        "",
        "45001062",
        "165",
        "Producción",
        "Activo"
    ],
    [
        "Ayelen Cabrera Gonzalez",
        "Asistente",
        "1161885630",
        "34817077",
        "202",
        "Calidad",
        "Activo"
    ],
    [
        "Azucena Ayelen Perez",
        "Asistente",
        "",
        "40948808",
        "127",
        "",
        "Activo"
    ],
    [
        "Braian Miguel Gonzalez",
        "Operador",
        "",
        "42436133",
        "146",
        "",
        "Activo"
    ],
    [
        "Brian Joan Genes",
        "Operador",
        "",
        "40308821",
        "164",
        "",
        "Activo"
    ],
    [
        "Bruno Angel Alegre",
        "Operador",
        "",
        "35186041",
        "166",
        "",
        "Activo"
    ],
    [
        "Cesar Eduardo Acosta",
        "Operador",
        "",
        "35098472",
        "121",
        "Mantenimiento",
        "Activo"
    ],
    [
        "Cintia Gisela Mendieta",
        "Supervisor",
        "",
        "31836006",
        "149",
        "Producción",
        "Activo"
    ],
    [
        "Claudio Ezequiel Costilla",
        "Operador",
        "",
        "43053305",
        "140",
        "",
        "Activo"
    ],
    [
        "Cristian Gomez",
        "Operador",
        "",
        "31765267",
        "TEMP-31765267",
        "Producción",
        "Activo"
    ],
    [
        "Daiana Nicole Franco Riveros",
        "Operador",
        "",
        "43399728",
        "151",
        "Calidad",
        "Activo"
    ],
    [
        "Daniel Eduardo Cardozo",
        "Lavadero",
        "",
        "31299747",
        "190",
        "Producción",
        "Activo"
    ],
    [
        "Daniela Silva",
        "Control en proceso",
        "",
        "35756845",
        "TEMP-35756845",
        "Producción",
        "Activo"
    ],
    [
        "Daniela Alejandra Quiros",
        "Control en proceso",
        "",
        "32308436",
        "131",
        "Calidad",
        "Activo"
    ],
    [
        "Dario Javier Piño",
        "Asistente",
        "",
        "40393953",
        "A1",
        "",
        "Activo"
    ],
    [
        "Diego Alfredo Escalante",
        "Operador",
        "",
        "43390766",
        "TEMP-43390766",
        "Producción",
        "Activo"
    ],
    [
        "Dylan Alexis Vega",
        "Operador",
        "",
        "44421609",
        "27",
        "",
        "Activo"
    ],
    [
        "Elizabeth Del Milagro Guevara",
        "Control en proceso",
        "",
        "42457944",
        "26",
        "",
        "Activo"
    ],
    [
        "Emanuel Jose Guerrero",
        "Operador",
        "",
        "39153699",
        "105",
        "",
        "Activo"
    ],
    [
        "Emmanuel Marcelo Gabriel Miranda",
        "Operador",
        "",
        "33007264",
        "155",
        "",
        "Activo"
    ],
    [
        "Enzo Julian Morales",
        "Operador",
        "",
        "42298353",
        "52",
        "",
        "Activo"
    ],
    [
        "Esteban Chavez",
        "Lavadero",
        "",
        "36440100",
        "216",
        "Lavadero",
        "Activo"
    ],
    [
        "Esteban Mateo Valdovino",
        "Operador",
        "",
        "43308301",
        "114",
        "",
        "Activo"
    ],
    [
        "Ezequiel Gonzalo Decima",
        "Operador",
        "",
        "33037450",
        "128",
        "",
        "Activo"
    ],
    [
        "Federico Roman Paez",
        "Operador",
        "",
        "44261543",
        "175",
        "Producción",
        "Activo"
    ],
    [
        "Fernando Torres",
        "Lavadero",
        "",
        "TMPTORRES",
        "TMP-TORRES",
        "Producción",
        "Activo"
    ],
    [
        "Fernando Gabriel Perez",
        "Lavadero",
        "",
        "36561990",
        "180",
        "",
        "Activo"
    ],
    [
        "Francisco Otermin",
        "Supervisor",
        "",
        "25619999",
        "188",
        "Producción",
        "Activo"
    ],
    [
        "Franco Agustin Jimenez",
        "Operador",
        "",
        "43224979",
        "132",
        "",
        "Activo"
    ],
    [
        "Franco Emiliano Ayala",
        "Operador",
        "",
        "44594349",
        "171",
        "Producción",
        "Activo"
    ],
    [
        "Franco Martin Almiron",
        "Operador",
        "",
        "38391780",
        "143",
        "",
        "Activo"
    ],
    [
        "Gabriel Rios",
        "Operador",
        "",
        "23507714",
        "TMP-RIOS",
        "",
        "Activo"
    ],
    [
        "Gabriel Nicolas Mieres",
        "Operador",
        "",
        "44398330",
        "133",
        "",
        "Activo"
    ],
    [
        "Gaston Gabriel Gomez",
        "Depósito",
        "",
        "28523205",
        "122",
        "Producción",
        "Activo"
    ],
    [
        "Gerardo De Seta",
        "Lavadero",
        "",
        "35321835",
        "210",
        "Producción",
        "Activo"
    ],
    [
        "Gonzalo Agustin Nobarvos",
        "Operador",
        "",
        "43907960",
        "672cb24b5d2abdd7f0afdb83",
        "",
        "Activo"
    ],
    [
        "Gonzalo Ivan Venencia",
        "Operador",
        "",
        "44002560",
        "153",
        "",
        "Activo"
    ],
    [
        "Gustavo Marcelo Cambria",
        "Mantenimiento",
        "",
        "22706617",
        "125",
        "Mantenimiento",
        "Activo"
    ],
    [
        "Hernan Dario Segovia",
        "Supervisor",
        "",
        "37595103",
        "5efe370a84fd2c001749622f",
        "",
        "Activo"
    ],
    [
        "Inés Abutti",
        "Supervisor",
        "",
        "18299833",
        "TEMP-18299833",
        "Producción",
        "Activo"
    ],
    [
        "Ismael Andres Soschinski",
        "Soporte EPPI",
        "",
        "31555201",
        "94",
        "",
        "Activo"
    ],
    [
        "Jason Leonel Hernandez",
        "Operador",
        "",
        "38486228",
        "54",
        "",
        "Activo"
    ],
    [
        "Jesus Alberto Bernal Falcon",
        "Operador",
        "",
        "95593912",
        "189",
        "Producción",
        "Activo"
    ],
    [
        "Jonathan Medrano",
        "Operador",
        "",
        "36044099",
        "TEMP-36044099",
        "Producción",
        "Activo"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/046-usuarios-pagina-2.json
export const userPageTwoRows = [
    [
        "Jonathan Andres Monzon",
        "Operador",
        "",
        "36440101",
        "TEMP-36440101",
        "Producción",
        "Activo"
    ],
    [
        "Jonathan Ezequiel Stricker",
        "Operador",
        "",
        "43442905",
        "138",
        "",
        "Activo"
    ],
    [
        "Jordan Emanuel Gerpe",
        "Operador",
        "",
        "45005560",
        "174",
        "Producción",
        "Activo"
    ],
    [
        "Juan Jose Falzone",
        "Gerente",
        "",
        "28434165",
        "93",
        "",
        "Activo"
    ],
    [
        "Juan Pablo Ojeda",
        "Supervisor",
        "",
        "29117347",
        "18",
        "",
        "Activo"
    ],
    [
        "Julian Fernandez",
        "Operador",
        "",
        "46185549",
        "212",
        "Producción",
        "Activo"
    ],
    [
        "Karen Lorena Rouco",
        "Control en proceso",
        "",
        "34729009",
        "144",
        "Calidad",
        "Activo"
    ],
    [
        "Karen Soledad Bumbalo",
        "Control en proceso",
        "",
        "38947244",
        "130",
        "",
        "Activo"
    ],
    [
        "Leandro Paz",
        "Lavadero",
        "",
        "39804387",
        "TEMP-39804387",
        "Producción",
        "Activo"
    ],
    [
        "Leandro Leonel Victoria",
        "Operador",
        "",
        "32253918",
        "10",
        "",
        "Activo"
    ],
    [
        "Leonardo Alberto Junco",
        "Operador",
        "",
        "27429217",
        "2",
        "",
        "Activo"
    ],
    [
        "Leonardo Javier Sanchez Preuss",
        "Supervisor",
        "",
        "33335670",
        "6",
        "",
        "Activo"
    ],
    [
        "Lucas Agustin Lezcano",
        "Lavadero",
        "",
        "44834451",
        "134",
        "",
        "Activo"
    ],
    [
        "Lucas Homero Bustos",
        "Operador",
        "",
        "38821078",
        "22",
        "",
        "Activo"
    ],
    [
        "Lucas Maximiliano Natuche",
        "Supervisor",
        "",
        "40979134",
        "40979134",
        "",
        "Activo"
    ],
    [
        "Luciano Javier Gonzalez",
        "Soporte Técnico",
        "",
        "43986866",
        "21",
        "",
        "Activo"
    ],
    [
        "Lucrecia Carrizo",
        "Control en proceso",
        "",
        "36827526",
        "268",
        "Producción",
        "Activo"
    ],
    [
        "Luis Ricardo Falconi Cruz",
        "Operador",
        "",
        "43182725",
        "115",
        "",
        "Activo"
    ],
    [
        "Manuelii Abdala",
        "Operador",
        "",
        "44384337",
        "211",
        "",
        "Activo"
    ],
    [
        "Marcelo David Schanzenbach",
        "Operador",
        "",
        "38562254",
        "14",
        "",
        "Activo"
    ],
    [
        "Marcelo Javier Moser",
        "Mantenimiento",
        "",
        "34996708",
        "33",
        "Mantenimiento",
        "Activo"
    ],
    [
        "Marcos Elias Centurion Leyva",
        "Operador",
        "",
        "43092726",
        "139",
        "",
        "Activo"
    ],
    [
        "Maria Laura Maurizio",
        "Gerente",
        "01160191753",
        "24249278",
        "213",
        "Producción",
        "Activo"
    ],
    [
        "Mariano Alberto Suarez",
        "Gerente",
        "",
        "18072621",
        "129",
        "",
        "Activo"
    ],
    [
        "Mario Javier Villa",
        "Operador",
        "",
        "37368792",
        "80",
        "",
        "Activo"
    ],
    [
        "Mateo Correa",
        "Operador",
        "",
        "45905290",
        "TEMP-45905290",
        "Producción",
        "Activo"
    ],
    [
        "Matias Ezequiel Sanchez",
        "Operador",
        "",
        "43182937",
        "192",
        "",
        "Activo"
    ],
    [
        "Mauricio David Alonso",
        "Operador",
        "",
        "44094858",
        "119",
        "",
        "Activo"
    ],
    [
        "Micaela Beatriz Gonzalez",
        "Jefe",
        "",
        "39963758",
        "9",
        "",
        "Activo"
    ],
    [
        "Milagros Monaco",
        "Control en proceso",
        "",
        "43508365",
        "TEMP-43508365",
        "Producción",
        "Activo"
    ],
    [
        "Myrian Liliana Medina",
        "Operador",
        "",
        "23884135",
        "3",
        "",
        "Activo"
    ],
    [
        "Nair Medina",
        "Control en proceso",
        "",
        "44930816",
        "999",
        "",
        "Activo"
    ],
    [
        "Naomi Giuliana Lafuente",
        "Asistente",
        "",
        "41559055",
        "152",
        "",
        "Activo"
    ],
    [
        "Natalia Grecco",
        "Control en proceso",
        "1153893338",
        "28776917",
        "248",
        "Calidad",
        "Activo"
    ],
    [
        "Natalia Silva",
        "Control en proceso",
        "",
        "27819651",
        "185",
        "Calidad",
        "Activo"
    ],
    [
        "Nestor Adan Ibañez",
        "Operador",
        "",
        "37186240",
        "107",
        "",
        "Activo"
    ],
    [
        "Nicolas Martin Viviani",
        "Jefe",
        "",
        "33435318",
        "1",
        "",
        "Activo"
    ],
    [
        "Oscar Adolfo Rau",
        "Mantenimiento",
        "",
        "31082992",
        "124",
        "Mantenimiento",
        "Activo"
    ],
    [
        "Pablo Ezequiel Da Costa",
        "Operador",
        "",
        "33996041",
        "204",
        "Producción",
        "Activo"
    ],
    [
        "Pablo Ezequiel Portillo",
        "Mantenimiento",
        "",
        "33343642",
        "112",
        "Mantenimiento",
        "Activo"
    ],
    [
        "Raul Suarez",
        "Operador",
        "",
        "40108800",
        "6740afb79e8ed78cd636ed6d",
        "",
        "Activo"
    ],
    [
        "Ricardo Ariel Gonzalez",
        "Supervisor",
        "",
        "31886193",
        "78",
        "",
        "Activo"
    ],
    [
        "Rodrigo Sebastian Davalos",
        "Operador",
        "",
        "43250734",
        "137",
        "",
        "Activo"
    ],
    [
        "Roxana Beatriz Segovia",
        "Operador",
        "",
        "32961355",
        "15",
        "",
        "Activo"
    ],
    [
        "Santiago Luna",
        "Depósito",
        "",
        "29433405",
        "53",
        "Producción",
        "Activo"
    ],
    [
        "Sebastián Ignacio Robledo",
        "Gerente",
        "1159946588",
        "29043067",
        "196",
        "Calidad",
        "Activo"
    ],
    [
        "Sebastian Lihue Frangi",
        "Supervisor",
        "",
        "41739156",
        "58",
        "",
        "Activo"
    ],
    [
        "Sergio Maidana",
        "Operador",
        "",
        "34076739",
        "TMP-34076739",
        "Producción",
        "Activo"
    ],
    [
        "Sergio Torres",
        "Operador",
        "",
        "29094542",
        "5fc388e819a7a40017317216",
        "",
        "Activo"
    ],
    [
        "Sergio Emanuel Quiroga",
        "Operador",
        "",
        "44381535",
        "181",
        "Producción",
        "Activo"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/007-clientes.json
export const clientRows = [
    [
        "Andrómaco",
        "",
        "Av. Ing Huergo 1145, C1107 CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Ariston",
        "",
        "O'Connor 555, Villa Sarmiento --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Aspen",
        "",
        "3439 Remedios, HJC, C1407 Cdad. Autónoma de Buenos Aires --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Baliarda",
        "",
        "Cochabamba 2525, C1252AAO CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Bernabó",
        "",
        "Terrada 2346, (C1416ARZ), CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Biosintex",
        "011 5883 5563",
        "Salom 651",
        "CABA",
        "Buenos Aires",
        "Argentina",
        "1 contacto"
    ],
    [
        "Casasco",
        "",
        "Boyaca 237 (C1406BHC) Ciudad De Buenos Aires – Argentina --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Dallas",
        "",
        "Uriarte 2123, C1425FND CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Fecofar",
        "",
        "Av. Pres. Juan Domingo Perón 2742 San Justo, B1754AZV Buenos Aires --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Finadiet",
        "",
        "Hipólito Yrigoyen 3769/71 (C1208ABE). CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Géminis Farmacéutica",
        "",
        "26 De Abril 3425, B1714KLU, Ituzaingó. Buenos Aires --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Gezzi",
        "",
        "Guevara 1357 - C1427BSG - Cdad. Aut. De Bs. As. - Argentina --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Helion Pharma",
        "",
        "C. M. CUENCA 648, VILLA LYNCH, SAN MARTÍN, BUENOS AIRES --",
        "",
        "",
        "",
        "2 contacto"
    ],
    [
        "Kilab",
        "",
        "Carlos M.Ramírez 1544 --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "MAR",
        "",
        "Avenida Gaona 3875, CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Otros",
        "",
        "--",
        "",
        "",
        "",
        "0 contacto"
    ],
    [
        "prueba",
        "",
        "test --",
        "",
        "",
        "",
        "0 contacto"
    ],
    [
        "Richmond",
        "",
        "Av. Elcano 4938, C1427CIU Cdad. Autónoma de Buenos Aires --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Roemmers",
        "011 4346 9744",
        "Fray Justo Sarmiento 2350",
        "Olivos",
        "BUENOS AIRES",
        "Argentina",
        "1 contacto"
    ],
    [
        "Ronnet",
        "",
        "José E. Rodó 5940 --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Rospaw",
        "",
        "Santos Dumont 4744, 1427. CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Sant Gall Friburg",
        "",
        "Av. Brasil 3131, CABA, Argentina --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Siegfried",
        "011 4346 9910",
        "Fray Justo Sarmiento 2350",
        "Olivos",
        "Buenos Aires",
        "Argentina",
        "1 contacto"
    ],
    [
        "Tauro",
        "",
        "Juan Agustín Garcia 5420 --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Temis Lostaló",
        "01163441300",
        "Zepita 3178",
        "CABA",
        "CABA",
        "Argentina",
        "1 contacto"
    ],
    [
        "Teva",
        "",
        "Juan José Castelli 6701 - B1652ACM - Villa Adelina - GBA - Argentina --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Vannier",
        "",
        "Benito Quinquela Martín 2228, C1296ADT CABA --",
        "",
        "",
        "",
        "1 contacto"
    ],
    [
        "Weltrap",
        "",
        "Balcarce 1072, Rosario, Santa Fé --",
        "",
        "",
        "",
        "0 contacto"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/008-productos.json
export const productPageOneRows = [
    [
        "Acenocoumarol",
        "Rospaw",
        "Comprimido recubierto",
        "4",
        "Miligramo",
        "ROS0001"
    ],
    [
        "Ácido Fólico Vannier",
        "Vannier",
        "Comprimido",
        "5",
        "Miligramo",
        "VAN0014"
    ],
    [
        "Ácido Fólico Vannier",
        "Vannier",
        "Comprimido",
        "1",
        "Miligramo",
        "VAN0017"
    ],
    [
        "Ácido Fólico Vannier",
        "Vannier",
        "Comprimido",
        "10",
        "Miligramo",
        "VAN0015"
    ],
    [
        "Acido Tioctico",
        "Casasco",
        "Comprimido recubierto",
        "600",
        "Miligramo",
        ""
    ],
    [
        "Aclusin",
        "Casasco",
        "Comprimido",
        "100",
        "Miligramo",
        "CAS0001"
    ],
    [
        "Alercas",
        "Casasco",
        "Comprimido recubierto",
        "60",
        "Miligramo",
        "CAS0004"
    ],
    [
        "Alercas",
        "Casasco",
        "Comprimido recubierto",
        "120",
        "Miligramo",
        "CAS0002"
    ],
    [
        "Alercas",
        "Casasco",
        "Comprimido recubierto",
        "180",
        "Miligramo",
        "CAS0003"
    ],
    [
        "Alercas Granulado",
        "Casasco",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Alercas Solución",
        "Casasco",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Alergitrat L",
        "Fecofar",
        "Comprimido",
        "",
        "",
        "FEC0001"
    ],
    [
        "Allerplus",
        "Gezzi",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Alrolam",
        "Ronnet",
        "Comprimido",
        "2",
        "Miligramo",
        ""
    ],
    [
        "Ambrisenex",
        "Finadiet",
        "Comprimido recubierto",
        "5",
        "Miligramo",
        "FIN0002"
    ],
    [
        "Ambrisenex",
        "Finadiet",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        "FIN0003"
    ],
    [
        "Amiptril",
        "Rospaw",
        "Comprimido",
        "25",
        "Miligramo",
        ""
    ],
    [
        "Amlodicord",
        "Géminis Farmacéutica",
        "Comprimido",
        "5",
        "Miligramo",
        "GEM0002"
    ],
    [
        "Amlodicord",
        "Géminis Farmacéutica",
        "Comprimido",
        "10",
        "Miligramo",
        "GEM0001"
    ],
    [
        "Amlodipina + Losartan",
        "Géminis Farmacéutica",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Amlodipina 5 Mg Granulado Teva",
        "Teva",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Amlopaw",
        "Rospaw",
        "Comprimido",
        "10",
        "Miligramo",
        "ROS0002"
    ],
    [
        "Amlopaw",
        "Rospaw",
        "Comprimido",
        "5",
        "Miligramo",
        "ROS0003"
    ],
    [
        "Amoxi 500 Mar Suspension 105/150",
        "MAR",
        "Suspensión",
        "",
        "",
        ""
    ],
    [
        "Amoxi Duo Mar Suspension",
        "MAR",
        "Suspensión",
        "",
        "",
        ""
    ],
    [
        "Amoxi Plus Mar",
        "MAR",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Ampliar",
        "Casasco",
        "Comprimido recubierto",
        "80",
        "Miligramo",
        ""
    ],
    [
        "Ampliar",
        "Casasco",
        "Comprimido recubierto",
        "20",
        "Miligramo",
        "CAS0006"
    ],
    [
        "Ampliar",
        "Casasco",
        "Comprimido recubierto",
        "40",
        "Miligramo",
        "CAS0007"
    ],
    [
        "Ampliar",
        "Casasco",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        "CAS0005"
    ],
    [
        "Ampliar Granulado",
        "Casasco",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Ampliar PLUS 10/10",
        "Casasco",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Ampliar Plus 20/10",
        "Casasco",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Antipresol",
        "Fecofar",
        "Comprimido recubierto",
        "100",
        "Miligramo",
        "FEC0002"
    ],
    [
        "Antipresol",
        "Fecofar",
        "Comprimido recubierto",
        "50",
        "Miligramo",
        "FEC0003"
    ],
    [
        "Antipresol A",
        "Fecofar",
        "Comprimido recubierto",
        "",
        "",
        "FEC0021"
    ],
    [
        "Antipresol A 100",
        "Fecofar",
        "Comprimido recubierto",
        "",
        "",
        "FEC0022"
    ],
    [
        "Antipresol D",
        "Fecofar",
        "Comprimido recubierto",
        "100",
        "Miligramo",
        ""
    ],
    [
        "Antipresol D",
        "Fecofar",
        "Comprimido recubierto",
        "",
        "",
        "FEC0020"
    ],
    [
        "Arteriosán Compuesto 5/100",
        "Bernabó",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Arteriosán Compuesto 5/100 (Amlodipina)",
        "Bernabó",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Arteriosán Compuesto 5/100 (Losartán)",
        "Bernabó",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Arteriosán Compuesto 5/50",
        "Bernabó",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Arteriosán Compuesto 5/50 (Amlodipina)",
        "Bernabó",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Arteriosán Compuesto 5/50 (Losartán)",
        "Bernabó",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Atelsta",
        "Ronnet",
        "Comprimido",
        "100",
        "Miligramo",
        "RON0002"
    ],
    [
        "Atelsta",
        "Ronnet",
        "Comprimido",
        "25",
        "Miligramo",
        "RON0001"
    ],
    [
        "Atelsta",
        "Ronnet",
        "Comprimido",
        "50",
        "Miligramo",
        "RON0015"
    ],
    [
        "Atelsta Comprimidos",
        "Ronnet",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Atelsta Comprimidos",
        "Ronnet",
        "Comprimido",
        "",
        "",
        ""
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/047-productos-pagina-2.json
export const productPageTwoRows = [
    [
        "Atormax",
        "Géminis Farmacéutica",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        "GEM0003"
    ],
    [
        "Atormax",
        "Géminis Farmacéutica",
        "Comprimido recubierto",
        "40",
        "Miligramo",
        "GEM0005"
    ],
    [
        "Atormax",
        "Géminis Farmacéutica",
        "Comprimido recubierto",
        "20",
        "Miligramo",
        "GEM0004"
    ],
    [
        "Atorvastatina Gezzi",
        "Gezzi",
        "Comprimido",
        "20",
        "Miligramo",
        ""
    ],
    [
        "Atorvastatina Gezzi",
        "Gezzi",
        "Comprimido",
        "10",
        "Miligramo",
        ""
    ],
    [
        "Baclox",
        "Ariston",
        "Comprimido",
        "10",
        "Miligramo",
        ""
    ],
    [
        "Beaplen",
        "Temis Lostaló",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        ""
    ],
    [
        "Beaplen",
        "Temis Lostaló",
        "Comprimido recubierto",
        "20",
        "Miligramo",
        ""
    ],
    [
        "Began 12",
        "Géminis Farmacéutica",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Bigetric",
        "Casasco",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Bilip",
        "Richmond",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        ""
    ],
    [
        "Bilip",
        "Richmond",
        "Comprimido recubierto",
        "20",
        "Miligramo",
        ""
    ],
    [
        "Bilip",
        "Richmond",
        "Comprimido recubierto",
        "40",
        "Miligramo",
        ""
    ],
    [
        "Biperideno",
        "Rospaw",
        "Comprimido",
        "2",
        "Miligramo",
        "ROS0004"
    ],
    [
        "Bisofec",
        "Fecofar",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        "FEC0005"
    ],
    [
        "Bisofec",
        "Fecofar",
        "Comprimido recubierto",
        "2.5",
        "Miligramo",
        "FEC0006"
    ],
    [
        "Bisofec",
        "Fecofar",
        "Comprimido recubierto",
        "5",
        "Miligramo",
        "FEC0007"
    ],
    [
        "Bisofec D",
        "Fecofar",
        "Comprimido recubierto",
        "",
        "",
        "FEC0019"
    ],
    [
        "Blokium Cox",
        "Casasco",
        "Comprimido recubierto",
        "90",
        "Miligramo",
        "CAS0008"
    ],
    [
        "Blokium Cox Gesic",
        "Casasco",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Blokium Flex",
        "Casasco",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Blokium Gesic",
        "Casasco",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Blokium Gesic Forte",
        "Casasco",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Cabal Comprimidos",
        "Dallas",
        "Comprimido",
        "",
        "",
        "DAL0001"
    ],
    [
        "Calcio Base Vannier",
        "Vannier",
        "Comprimido",
        "",
        "",
        ""
    ],
    [
        "Calmador Dex",
        "Finadiet",
        "Comprimido recubierto",
        "",
        "",
        "FIN0004"
    ],
    [
        "Calmador Plus",
        "Finadiet",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Carvicord",
        "Géminis Farmacéutica",
        "Comprimido",
        "50",
        "Miligramo",
        "GEM0009"
    ],
    [
        "Carvicord",
        "Géminis Farmacéutica",
        "Comprimido",
        "25",
        "Miligramo",
        "GEM0008"
    ],
    [
        "Carvicord",
        "Géminis Farmacéutica",
        "Comprimido",
        "12.5",
        "Miligramo",
        "GEM0007"
    ],
    [
        "Carvicord",
        "Géminis Farmacéutica",
        "Comprimido",
        "6.25",
        "Miligramo",
        "GEM0006"
    ],
    [
        "Carvicord Granulado Madre",
        "Géminis Farmacéutica",
        "Granulado",
        "",
        "",
        ""
    ],
    [
        "Carvipaw",
        "Rospaw",
        "Comprimido",
        "6.25",
        "Miligramo",
        "ROS0006"
    ],
    [
        "Carvipaw",
        "Rospaw",
        "Comprimido",
        "12.5",
        "Miligramo",
        "ROS0007"
    ],
    [
        "Carvipaw",
        "Rospaw",
        "Comprimido",
        "25",
        "Miligramo",
        "ROS0005"
    ],
    [
        "Cestropan",
        "Ronnet",
        "Comprimido",
        "500",
        "Miligramo",
        "RON0003"
    ],
    [
        "Cestropan",
        "Ronnet",
        "Otro",
        "",
        "",
        ""
    ],
    [
        "Cetirizina Teva",
        "Teva",
        "Comprimido recubierto",
        "10",
        "Miligramo",
        "TEV0001"
    ],
    [
        "Ciapar",
        "Biosintex",
        "Comprimido recubierto",
        "",
        "",
        ""
    ],
    [
        "Cilospaw",
        "Rospaw",
        "Comprimido",
        "100",
        "Miligramo",
        "ROS0009"
    ],
    [
        "Cilospaw",
        "Rospaw",
        "Comprimido",
        "50",
        "Miligramo",
        "ROS0008"
    ],
    [
        "Ciprofloxacina",
        "Sant Gall Friburg",
        "Comprimido recubierto",
        "500",
        "Miligramo",
        "VAN0012"
    ],
    [
        "Cipromar",
        "MAR",
        "Comprimido recubierto",
        "500",
        "Miligramo",
        "MAR0001"
    ],
    [
        "Claritromicina Vannier",
        "Vannier",
        "Comprimido recubierto",
        "500",
        "Miligramo",
        "VAN0002"
    ],
    [
        "Clonazepam",
        "Rospaw",
        "Comprimido",
        "1",
        "Miligramo",
        "ROS0010"
    ],
    [
        "Clonazepam",
        "Rospaw",
        "Comprimido recubierto",
        "0.5",
        "Miligramo",
        "ROS0011"
    ],
    [
        "Clonazepam",
        "Rospaw",
        "Comprimido",
        "2",
        "Miligramo",
        "ROS0012"
    ],
    [
        "Conductasa",
        "Casasco",
        "Comprimido recubierto",
        "1200",
        "Miligramo",
        "CAS0055"
    ],
    [
        "Conductasa",
        "Casasco",
        "Comprimido recubierto",
        "500",
        "Miligramo",
        "CAS0053"
    ],
    [
        "Conductasa",
        "Casasco",
        "Comprimido recubierto",
        "800",
        "Miligramo",
        "CAS0054"
    ]
] as const satisfies readonly CapturedTableRow[];

export const eppiUsersCapture: EppiCapturedPagination = {
    advertisedPageCount: 3,
    visiblePageLabels: ['1', '2', '3'],
    pages: [
        createCapturedPage(1, 'ui-audit-structural/screens/006-usuarios.json', 'users-page-1', userColumns, userPageOneRows),
        createCapturedPage(2, 'ui-audit-structural/screens/046-usuarios-pagina-2.json', 'users-page-2', userColumns, userPageTwoRows),
    ],
    unavailableRanges: [{ from: 3, to: 3 }],
};
export const eppiProductsCapture: EppiCapturedPagination = {
    advertisedPageCount: 9,
    visiblePageLabels: ['1', '2', '3', '4', '...', '9'],
    pages: [
        createCapturedPage(1, 'ui-audit-structural/screens/008-productos.json', 'products-page-1', productColumns, productPageOneRows),
        createCapturedPage(2, 'ui-audit-structural/screens/047-productos-pagina-2.json', 'products-page-2', productColumns, productPageTwoRows),
    ],
    unavailableRanges: [{ from: 3, to: 9 }],
};

export const eppiUsersTable: EppiTableDefinition = createTableDefinition('users-page-1', 'Usuarios', userColumns, userPageOneRows, { pagination: eppiUsersCapture });
export const eppiClientsTable: EppiTableDefinition = createTableDefinition('clients', 'Clientes', clientColumns, clientRows, { minWidth: 1240 });
export const eppiProductsTable: EppiTableDefinition = createTableDefinition('products-page-1', 'Productos', productColumns, productPageOneRows, { pagination: eppiProductsCapture });
