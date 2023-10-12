/* Pi-hole: A black hole for Internet advertisements
 *  (c) 2017 Pi-hole, LLC (https://pi-hole.net)
 *  Network-wide ad blocking via your own hardware.
 *
 *  This file is copyright under the latest version of the EUPL.
 *  Please see LICENSE file for your rights under this license. */

/* global utils:false, groups:false,, apiFailure:false, updateFtlInfo:false, getGroups:false */

var table;

function reloadClientSuggestions() {
  $.ajax({
    url: "/api/clients/_suggestions",
    type: "GET",
    dataType: "json",
    success: function (data) {
      var sel = $("#select");
      sel.empty();

      // In order for the placeholder value to appear, we have to have a blank
      // <option> as the first option in our <select> control. This is because
      // the browser tries to select the first option by default. If our first
      // option were non-empty, the browser would display this instead of the
      // placeholder.
      sel.append($("<option />"));

      // Add data obtained from API
      for (var i = 0; i < data.clients.length; i++) {
        const client = data.clients[i];
        let mockDevice = false;
        var text = client.hwaddr.toUpperCase();
        var key = text;
        if (key.startsWith("IP-")) {
          // Mock MAC address for address-only devices
          mockDevice = true;
          key = key.substring(3);
          text = key;
        }

        // Append additional infos if available
        var extraInfo = "";
        if (client.names !== null && client.names.length > 0) {
          // Count number of "," in client.names to determine number of hostnames
          var numHostnames = client.names.split(",").length;
          const pluralHostnames = numHostnames > 1 ? "s" : "";
          extraInfo =
            numHostnames + " hostname" + pluralHostnames + ": " + utils.escapeHtml(client.names);
        }

        if (client.macVendor !== null && client.macVendor.length > 0) {
          if (extraInfo.length > 0) extraInfo += "; ";
          extraInfo += "vendor: " + utils.escapeHtml(client.macVendor);
        }

        // Do not add addresses for mock devices as their address is already
        // the hwaddr
        if (client.addresses !== null && client.addresses.length > 0 && !mockDevice) {
          if (extraInfo.length > 0) extraInfo += "; ";
          // Count number of "," in client.addresses to determine number of addresses
          var numAddresses = client.addresses.split(",").length;
          const pluralAddresses = numAddresses > 1 ? "es" : "";
          extraInfo +=
            numAddresses + " address" + pluralAddresses + ": " + utils.escapeHtml(client.addresses);
        }

        if (extraInfo.length > 0) text += " (" + extraInfo + ")";

        sel.append($("<option />").val(key).text(text));
      }
    },
  });
}

$(function () {
  $("#btnAdd").on("click", addClient);
  $("select").select2({
    tags: true,
    placeholder: "Select client...",
    allowClear: true,
  });

  reloadClientSuggestions();
  utils.setBsSelectDefaults();
  initTable();

  $("#select").on("change", function () {
    $("#ip-custom").val("");
    $("#ip-custom").prop("disabled", $("#select option:selected").val() !== "custom");
  });
});

function initTable() {
  table = $("#clientsTable")
    .on("preXhr.dt", function () {
      getGroups();
    })
    .DataTable({
      processing: true,
      ajax: {
        url: "/api/clients",
        dataSrc: "clients",
        type: "GET",
      },
      order: [[0, "asc"]],
      columns: [
        { data: "id", visible: false },
        { data: null, visible: true, orderable: false, width: "15px" },
        { data: "client", type: "ip-address" },
        { data: "comment" },
        { data: "groups", searchable: false },
        { data: null, width: "22px", orderable: false },
      ],
      columnDefs: [
        {
          targets: 1,
          className: "select-checkbox",
          render: function () {
            return "";
          },
        },
        {
          targets: "_all",
          render: $.fn.dataTable.render.text(),
        },
      ],
      drawCallback: function () {
        // Hide buttons if all clients were deleted
        var hasRows = this.api().rows({ filter: "applied" }).data().length > 0;
        $(".datatable-bt").css("visibility", hasRows ? "visible" : "hidden");

        $('button[id^="deleteClient_"]').on("click", deleteClient);
        // Remove visible dropdown to prevent orphaning
        $("body > .bootstrap-select.dropdown").remove();
      },
      rowCallback: function (row, data) {
        var dataId = utils.hexEncode(data.client);
        $(row).attr("data-id", dataId);
        var tooltip =
          "Added: " +
          utils.datetime(data.date_added, false) +
          "\nLast modified: " +
          utils.datetime(data.date_modified, false) +
          "\nDatabase ID: " +
          data.id;
        var ipName =
          '<code id="ip_' +
          dataId +
          '" title="' +
          tooltip +
          '" class="breakall">' +
          data.client +
          "</code>";
        if (data.name !== null && data.name.length > 0)
          ipName +=
            '<br><code id="name_' +
            dataId +
            '" title="' +
            tooltip +
            '" class="breakall">' +
            data.name +
            "</code>";
        $("td:eq(1)", row).html(ipName);

        $("td:eq(2)", row).html('<input id="comment_' + dataId + '" class="form-control">');
        var commentEl = $("#comment_" + dataId, row);
        commentEl.val(utils.unescapeHtml(data.comment));
        commentEl.on("change", editClient);

        $("td:eq(3)", row).empty();
        $("td:eq(3)", row).append(
          '<select class="selectpicker" id="multiselect_' + dataId + '" multiple></select>'
        );
        var selectEl = $("#multiselect_" + dataId, row);
        // Add all known groups
        for (var i = 0; i < groups.length; i++) {
          var dataSub = "";
          if (!groups[i].enabled) {
            dataSub = 'data-subtext="(disabled)"';
          }

          selectEl.append(
            $("<option " + dataSub + "/>")
              .val(groups[i].id)
              .text(groups[i].name)
          );
        }

        // Select assigned groups
        selectEl.val(data.groups);
        // Initialize bootstrap-select
        selectEl
          // fix dropdown if it would stick out right of the viewport
          .on("show.bs.select", function () {
            var winWidth = $(window).width();
            var dropdownEl = $("body > .bootstrap-select.dropdown");
            if (dropdownEl.length > 0) {
              dropdownEl.removeClass("align-right");
              var width = dropdownEl.width();
              var left = dropdownEl.offset().left;
              if (left + width > winWidth) {
                dropdownEl.addClass("align-right");
              }
            }
          })
          .on("changed.bs.select", function () {
            // enable Apply button
            if ($(applyBtn).prop("disabled")) {
              $(applyBtn)
                .addClass("btn-success")
                .prop("disabled", false)
                .on("click", function () {
                  editClient.call(selectEl);
                });
            }
          })
          .on("hide.bs.select", function () {
            // Restore values if drop-down menu is closed without clicking the Apply button
            if (!$(applyBtn).prop("disabled")) {
              $(this).val(data.groups).selectpicker("refresh");
              $(applyBtn).removeClass("btn-success").prop("disabled", true).off("click");
            }
          })
          .selectpicker()
          .siblings(".dropdown-menu")
          .find(".bs-actionsbox")
          .prepend(
            '<button type="button" id=btn_apply_' +
              dataId +
              ' class="btn btn-block btn-sm" disabled>Apply</button>'
          );

        var applyBtn = "#btn_apply_" + dataId;

        var button =
          '<button type="button" class="btn btn-danger btn-xs" id="deleteClient_' +
          dataId +
          '" data-id="' +
          dataId +
          '">' +
          '<span class="far fa-trash-alt"></span>' +
          "</button>";
        $("td:eq(4)", row).html(button);
      },
      select: {
        style: "multi",
        selector: "td:not(:last-child)",
        info: false,
      },
      buttons: [
        {
          text: '<span class="far fa-square"></span>',
          titleAttr: "Select All",
          className: "btn-sm datatable-bt selectAll",
          action: function () {
            table.rows({ page: "current" }).select();
          },
        },
        {
          text: '<span class="far fa-plus-square"></span>',
          titleAttr: "Select All",
          className: "btn-sm datatable-bt selectMore",
          action: function () {
            table.rows({ page: "current" }).select();
          },
        },
        {
          extend: "selectNone",
          text: '<span class="far fa-check-square"></span>',
          titleAttr: "Deselect All",
          className: "btn-sm datatable-bt removeAll",
        },
        {
          text: '<span class="far fa-trash-alt"></span>',
          titleAttr: "Delete Selected",
          className: "btn-sm datatable-bt deleteSelected",
          action: function () {
            // For each ".selected" row ...
            var ids = [];
            $("tr.selected").each(function () {
              // ... add the row identified by "data-id".
              ids.push($(this).attr("data-id"));
            });
            // Delete all selected rows at once
            delItems(ids);
          },
        },
      ],
      dom:
        "<'row'<'col-sm-6'l><'col-sm-6'f>>" +
        "<'row'<'col-sm-3'B><'col-sm-9'p>>" +
        "<'row'<'col-sm-12'<'table-responsive'tr>>>" +
        "<'row'<'col-sm-3'B><'col-sm-9'p>>" +
        "<'row'<'col-sm-12'i>>",
      lengthMenu: [
        [10, 25, 50, 100, -1],
        [10, 25, 50, 100, "All"],
      ],
      stateSave: true,
      stateDuration: 0,
      stateSaveCallback: function (settings, data) {
        utils.stateSaveCallback("groups-clients-table", data);
      },
      stateLoadCallback: function () {
        var data = utils.stateLoadCallback("groups-clients-table");

        // Return if not available
        if (data === null) {
          return null;
        }

        // Reset visibility of ID column
        data.columns[0].visible = false;
        // Apply loaded state to table
        return data;
      },
    });

  // Disable autocorrect in the search box
  var input = document.querySelector("input[type=search]");
  if (input !== null) {
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", false);
  }

  table.on("init select deselect", function () {
    utils.changeBulkDeleteStates(table);
  });

  table.on("order.dt", function () {
    var order = table.order();
    if (order[0][0] !== 0 || order[0][1] !== "asc") {
      $("#resetButton").removeClass("hidden");
    } else {
      $("#resetButton").addClass("hidden");
    }
  });

  $("#resetButton").on("click", function () {
    table.order([[0, "asc"]]).draw();
    $("#resetButton").addClass("hidden");
  });
}

// Remove 'bnt-group' class from container, to avoid grouping
$.fn.dataTable.Buttons.defaults.dom.container.className = "dt-buttons";

function deleteClient() {
  // Passes the button data-id attribute as ID
  const ids = [$(this).attr("data-id")];
  delItems(ids);
}

function delItems(ids) {
  // Check input validity
  if (!Array.isArray(ids)) return;

  // Get first element from array
  const clientRaw = ids[0];
  const client = utils.hexDecode(clientRaw);

  // Remove first element from array
  ids.shift();

  utils.disableAll();
  const idstring = ids.join(", ");
  utils.showAlert("info", "", "Deleting client...", client);

  $.ajax({
    url: "/api/clients/" + encodeURIComponent(client),
    method: "delete",
  })
    .done(function () {
      utils.enableAll();
      utils.showAlert("success", "far fa-trash-alt", "Successfully deleted client: ", client);
      table.row(clientRaw).remove().draw(false);
      if (ids.length > 0) {
        // Recursively delete all remaining items
        delItems(ids);
        return;
      }

      table.ajax.reload(null, false);

      // Clear selection after deletion
      table.rows().deselect();
      utils.changeBulkDeleteStates(table);

      // Update number of clients in the sidebar
      updateFtlInfo();
    })
    .fail(function (data, exception) {
      apiFailure(data);
      utils.enableAll();
      utils.showAlert(
        "error",
        "",
        "Error while deleting client(s): " + idstring,
        data.responseText
      );
      console.log(exception); // eslint-disable-line no-console
    });
}

function addClient() {
  var ip = utils.escapeHtml($("#select").val().trim());
  const comment = utils.escapeHtml($("#new_comment").val());

  utils.disableAll();
  utils.showAlert("info", "", "Adding client...", ip);

  if (ip.length === 0) {
    utils.enableAll();
    utils.showAlert("warning", "", "Warning", "Please specify a client IP or MAC address");
    return;
  }

  // Validate input, can be:
  // - IPv4 address (with and without CIDR)
  // - IPv6 address (with and without CIDR)
  // - MAC address (in the form AA:BB:CC:DD:EE:FF)
  // - host name (arbitrary form, we're only checking against some reserved characters)
  if (utils.validateIPv4CIDR(ip) || utils.validateIPv6CIDR(ip) || utils.validateMAC(ip)) {
    // Convert input to upper case (important for MAC addresses)
    ip = ip.toUpperCase();
  } else if (!utils.validateHostname(ip)) {
    utils.enableAll();
    utils.showAlert(
      "warning",
      "",
      "Warning",
      "Input is neither a valid IP or MAC address nor a valid host name!"
    );
    return;
  }

  $.ajax({
    url: "/api/clients",
    method: "post",
    dataType: "json",
    data: { client: ip, comment: comment },
    success: function () {
      utils.enableAll();
      utils.showAlert("success", "fas fa-plus", "Successfully added client", ip);
      reloadClientSuggestions();
      table.ajax.reload(null, false);
      table.rows().deselect();

      // Update number of groups in the sidebar
      updateFtlInfo();
    },
    error: function (data, exception) {
      apiFailure(data);
      utils.enableAll();
      utils.showAlert("error", "", "Error while adding new client", data.responseText);
      console.log(exception); // eslint-disable-line no-console
    },
  });
}

function editClient() {
  const elem = $(this).attr("id");
  const tr = $(this).closest("tr");
  const client = tr.attr("data-id");
  // Convert list of string integers to list of integers using map(Number)
  const groups = tr
    .find("#multiselect_" + client)
    .val()
    .map(Number);
  const comment = utils.escapeHtml(tr.find("#comment_" + client).val());
  const enabled = tr.find("#enabled_" + client).is(":checked");

  var done = "edited";
  var notDone = "editing";
  switch (elem) {
    case "multiselect_" + client:
      done = "edited groups of";
      notDone = "editing groups of";
      break;
    case "comment_" + client:
      done = "edited comment of";
      notDone = "editing comment of";
      break;
    default:
      alert("bad element (" + elem + ") or invalid data-id!");
      return;
  }

  utils.disableAll();
  const clientDecoded = utils.hexDecode(client);
  utils.showAlert("info", "", "Editing client...", clientDecoded);
  $.ajax({
    url: "/api/clients/" + encodeURIComponent(clientDecoded),
    method: "put",
    dataType: "json",
    data: {
      client: client,
      groups: groups,
      comment: comment,
      enabled: enabled,
    },
    success: function () {
      utils.enableAll();
      utils.showAlert(
        "success",
        "fas fa-pencil-alt",
        "Successfully " + done + " client",
        clientDecoded
      );
      table.ajax.reload(null, false);
    },
    error: function (data, exception) {
      apiFailure(data);
      utils.enableAll();
      utils.showAlert(
        "error",
        "",
        "Error while " + notDone + " client " + clientDecoded,
        data.responseText
      );
      console.log(exception); // eslint-disable-line no-console
    },
  });
}
